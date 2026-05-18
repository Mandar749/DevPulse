const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const AIRTABLE_API_TOKEN = Deno.env.get('AIRTABLE_API_TOKEN') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const AIRTABLE_BASE_ID = 'appT1VTAFxjHdkKn2';
const TABLE_ACTIVITY_EVENTS = 'tblZgCdLi1X34Hbng';
const TABLE_DEVELOPER_CONTEXT = 'tbl82g1bm9Soet9Sg';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ActivityRecord {
  id: string;
  fields: {
    developer_username?: string;
    platform?: string;
    event_type?: string;
    timestamp?: string;
    hour_of_day?: number;
    is_weekend?: boolean;
    commit_message_length?: number;
    repo_name?: string;
    team_id?: string;
  };
}

async function upsertDeveloperContext(
  developerUsername: string,
  status: string,
  teamId: string,
  updateAlertSentAt = true,
): Promise<{ created: boolean; ok: boolean; detail: unknown }> {
  const filter = `{developer_username} = "${developerUsername}"`;
  const findUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${TABLE_DEVELOPER_CONTEXT}?filterByFormula=${encodeURIComponent(filter)}&maxRecords=1`;
  const findRes = await fetch(findUrl, { method: 'GET', headers: { Authorization: `Bearer ${AIRTABLE_API_TOKEN}`, 'Content-Type': 'application/json' } });
  const findData = await findRes.json();
  const records = findData.records ?? [];
  const nowIso = new Date().toISOString();

  const fields: Record<string, string> = { developer_username: developerUsername, team_id: teamId, status };
  if (updateAlertSentAt) fields.alert_sent_at = nowIso;

  if (records.length === 0) {
    const createRes = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${TABLE_DEVELOPER_CONTEXT}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${AIRTABLE_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    const createData = await createRes.json().catch(() => ({}));
    return { created: true, ok: createRes.ok, detail: { status: createRes.status, body: createData } };
  }

  const recordId = records[0].id;
  const patchFields: Record<string, string> = { status };
  if (updateAlertSentAt) patchFields.alert_sent_at = nowIso;

  const patchRes = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${TABLE_DEVELOPER_CONTEXT}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${AIRTABLE_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [{ id: recordId, fields: patchFields }] }),
  });
  const patchData = await patchRes.json().catch(() => ({}));
  return { created: false, ok: patchRes.ok, detail: { status: patchRes.status, body: patchData } };
}

async function fetchActivityEvents(developerUsername: string, days: number): Promise<ActivityRecord[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const filter = `AND({developer_username} = "${developerUsername}", {timestamp} >= "${since.toISOString()}")`;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${TABLE_ACTIVITY_EVENTS}?filterByFormula=${encodeURIComponent(filter)}&sort[0][field]=timestamp&sort[0][direction]=asc`;
  const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${AIRTABLE_API_TOKEN}`, 'Content-Type': 'application/json' } });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || `Airtable fetch failed: ${res.status}`);
  }
  const data = await res.json();
  return data.records ?? [];
}

async function checkSuppressStatus(developerUsername: string): Promise<{ suppressed: boolean; reason: string | null; until: string | null }> {
  const filter = `{developer_username} = "${developerUsername}"`;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${TABLE_DEVELOPER_CONTEXT}?filterByFormula=${encodeURIComponent(filter)}&maxRecords=1`;
  const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${AIRTABLE_API_TOKEN}`, 'Content-Type': 'application/json' } });
  const data = await res.json();
  const records = data.records ?? [];
  if (records.length === 0) return { suppressed: false, reason: null, until: null };

  const fields = records[0].fields ?? {};
  const suppressUntil = fields.suppress_until ? String(fields.suppress_until) : null;
  const suppressReason = fields.suppress_reason ? String(fields.suppress_reason) : null;
  if (!suppressUntil) return { suppressed: false, reason: null, until: null };

  const untilDate = new Date(suppressUntil);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (untilDate >= today) return { suppressed: true, reason: suppressReason, until: suppressUntil };
  return { suppressed: false, reason: null, until: null };
}

function buildPrompt(records: ActivityRecord[], developerUsername: string, days: number): string {
  const commits = records.filter((r) => r.fields.event_type === 'commit');
  const prOpened = records.filter((r) => r.fields.event_type === 'pr_opened');
  const prReviewed = records.filter((r) => r.fields.event_type === 'pr_reviewed');
  const issueResponses = records.filter((r) => r.fields.event_type === 'issue_response');
  const weekendEvents = records.filter((r) => r.fields.is_weekend);
  const lateNightEvents = records.filter((r) => { const h = r.fields.hour_of_day ?? 0; return h >= 22 || h <= 5; });

  const timestamps = records.map((r) => new Date(r.fields.timestamp ?? '').getTime()).filter((t) => !isNaN(t));
  const firstDate = timestamps.length > 0 ? new Date(Math.min(...timestamps)).toISOString().slice(0, 10) : 'N/A';
  const lastDate = timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString().slice(0, 10) : 'N/A';

  const dailyCounts: Record<string, number> = {};
  records.forEach((r) => { const d = (r.fields.timestamp ?? '').slice(0, 10); if (d) dailyCounts[d] = (dailyCounts[d] || 0) + 1; });
  const activeDays = Object.keys(dailyCounts).sort();
  const activityTrend = activeDays.map((d) => `${d}: ${dailyCounts[d]} events`).join('\n');
  const avgCommitLength = commits.length > 0 ? (commits.reduce((sum, r) => sum + (r.fields.commit_message_length ?? 0), 0) / commits.length).toFixed(1) : '0';

  return `You are a wellbeing analyst for engineering teams. Analyze the following behavioral metadata for developer "${developerUsername}" and provide a burnout risk assessment.

DATA SUMMARY (last ${activeDays.length} active days, ${days} day window):
- Total events: ${records.length}
- Commits: ${commits.length}
- PRs opened: ${prOpened.length}
- PRs reviewed: ${prReviewed.length}
- Issue responses: ${issueResponses.length}
- Weekend events: ${weekendEvents.length}
- Late night events (10pm-5am): ${lateNightEvents.length}
- Date range: ${firstDate} to ${lastDate}
- Average commit message length: ${avgCommitLength} chars

DAILY ACTIVITY:
${activityTrend}

Respond only with a valid JSON object, no markdown, no backticks, no explanation. The JSON must have these exact keys: burnout_risk (low/medium/high), confidence (0.0-1.0), signals (array of strings), wellbeing_tips (array of strings), checkin_message (string).

Rules:
- Use only the metadata provided. Do not hallucinate.
- High risk if: frequent late night work, declining activity trend, many weekend events, very short commit messages.
- Low risk if: consistent schedule, few weekend/late events, stable activity.
- The checkin_message should be warm, non-accusatory, and offer support.`;
}

async function callGemini(prompt: string, logs: Array<{ step: string; detail?: unknown }>): Promise<string> {
  const url = `${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`;
  const requestBody = { contents: [{ parts: [{ text: prompt }] }] };
  logs.push({ step: 'llm_request', detail: { url: GEMINI_ENDPOINT } });
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
  const rawText = await res.text();
  logs.push({ step: 'llm_response', detail: { status: res.status, raw: rawText.slice(0, 2000) } });
  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
  const data = JSON.parse(rawText);
  if (data.error) throw new Error(`Gemini API error: ${data.error.code} — ${data.error.message}`);
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function checkShouldSendAlert(developerUsername: string): Promise<{ shouldSend: boolean; lastAlertAt: string | null }> {
  const filter = `{developer_username} = "${developerUsername}"`;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${TABLE_DEVELOPER_CONTEXT}?filterByFormula=${encodeURIComponent(filter)}&maxRecords=1`;
  const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${AIRTABLE_API_TOKEN}`, 'Content-Type': 'application/json' } });
  const data = await res.json();
  const records = data.records ?? [];
  if (records.length === 0) return { shouldSend: true, lastAlertAt: null };
  const alertSentAt = records[0].fields?.alert_sent_at ? String(records[0].fields.alert_sent_at) : null;
  if (!alertSentAt) return { shouldSend: true, lastAlertAt: null };
  const lastAlert = new Date(alertSentAt);
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  return { shouldSend: lastAlert < fourteenDaysAgo, lastAlertAt: alertSentAt };
}

async function sendEmailAlert(
  toEmail: string,
  teamLeadName: string,
  developerUsername: string,
  analysis: Record<string, unknown>,
  appUrl: string,
  logs: Array<{ step: string; detail?: unknown }>,
): Promise<{ sent: boolean; detail: unknown }> {
  const risk = (analysis.burnout_risk as string) ?? 'medium';
  const confidence = ((analysis.confidence as number) ?? 0) * 100;
  const signals = (analysis.signals as string[]) ?? [];
  const tips = (analysis.wellbeing_tips as string[]) ?? [];
  const checkinMessage = (analysis.checkin_message as string) || '';
  const riskColor = risk === 'high' ? '#EF4444' : risk === 'medium' ? '#F59E0B' : '#10B981';
  const riskLabel = risk.toUpperCase();

  const subject = `DevPulse Alert: Check in with ${developerUsername}`;
  const textBody = `Hi ${teamLeadName || 'Team Lead'},\n\nDevPulse has detected some patterns worth a quick check-in with ${developerUsername}.\n\nRisk Level: ${riskLabel}\nConfidence: ${confidence.toFixed(0)}%\n\nSignals:\n${signals.map((s) => `• ${s}`).join('\n')}\n\nSuggested Check-in:\n${checkinMessage}\n\nWellbeing Tips:\n${tips.map((t) => `• ${t}`).join('\n')}\n\nThis is a private alert — not a diagnosis.\n\n— DevPulse`;
  const htmlBody = `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f8fafc;padding:24px;"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;"><p>Hi <strong>${teamLeadName || 'Team Lead'}</strong>,</p><p>DevPulse has detected some patterns worth a quick check-in with <strong>${developerUsername}</strong>.</p><p style="font-size:22px;font-weight:700;color:${riskColor};">${riskLabel} RISK — ${confidence.toFixed(0)}% confidence</p><h3>Signals Detected</h3><ul>${signals.map((s) => `<li>${s}</li>`).join('')}</ul><h3>Suggested Check-in</h3><p style="background:#eff6ff;padding:16px;border-radius:8px;color:#1e40af;">${checkinMessage}</p><h3>Wellbeing Tips</h3><ul>${tips.map((t) => `<li>${t}</li>`).join('')}</ul><p style="color:#9ca3af;font-size:13px;">This is a private alert visible only to you. DevPulse flags patterns for human review — not as a diagnosis.</p><a href="${appUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;">View full details</a><p style="color:#9ca3af;margin-top:24px;">— DevPulse</p></div></body></html>`;

  if (RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'DevPulse <onboarding@resend.dev>', to: [toEmail], subject, text: textBody, html: htmlBody }),
      });
      const resData = await res.json().catch(() => ({}));
      logs.push({ step: 'email_send', detail: { provider: 'resend', status: res.status, id: resData.id } });
      return res.ok ? { sent: true, detail: { provider: 'resend', id: resData.id } } : { sent: false, detail: resData };
    } catch (e) {
      logs.push({ step: 'email_error', detail: e.message });
      return { sent: false, detail: e.message };
    }
  }

  logs.push({ step: 'email_logged', detail: { to: toEmail, subject } });
  return { sent: true, detail: { provider: 'logged' } };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const logs: Array<{ step: string; detail?: unknown }> = [];

  if (!GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY is not set', debug_logs: logs }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const body = await req.json();
    const { action, developer_username, days = 90, team_id, team_lead_email, team_lead_name, app_url } = body;
    const resolvedTeamId = team_id ?? 'team-001';

    logs.push({ step: 'request', detail: { action, developer_username, days } });

    if (action !== 'analyze_developer') {
      return new Response(JSON.stringify({ error: 'Unknown action. Use analyze_developer.', debug_logs: logs }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!developer_username) {
      return new Response(JSON.stringify({ error: 'developer_username is required', debug_logs: logs }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const suppress = await checkSuppressStatus(developer_username);
    logs.push({ step: 'suppress_result', detail: suppress });
    if (suppress.suppressed) {
      return new Response(JSON.stringify({ success: true, suppressed: true, message: `Analysis suppressed — ${suppress.reason || 'Self-reported absence'} until ${suppress.until?.slice(0, 10)}`, debug_logs: logs }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    logs.push({ step: 'airtable_fetch_start', detail: { developer_username, days } });
    const records = await fetchActivityEvents(developer_username, days);
    logs.push({ step: 'airtable_fetch_done', detail: { record_count: records.length } });

    if (records.length === 0) {
      return new Response(JSON.stringify({ success: true, analysis: { burnout_risk: 'low', confidence: 0.5, signals: [], wellbeing_tips: ['Encourage regular commits so patterns can be monitored.'], checkin_message: 'Hey! Just checking in — how are things going?' }, debug_logs: logs }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const prompt = buildPrompt(records, developer_username, days);
    const rawContent = await callGemini(prompt, logs);

    let analysis: Record<string, unknown>;
    try {
      const cleaned = rawContent.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
      analysis = JSON.parse(cleaned);
    } catch {
      logs.push({ step: 'parse_error', detail: { raw: rawContent } });
      analysis = { burnout_risk: 'low', confidence: 0.5, signals: [], wellbeing_tips: ['Try running analysis again.'], checkin_message: 'Hey! Just checking in — how are things going?' };
    }

    const risk = (analysis.burnout_risk as string) || 'low';
    const mappedStatus = risk === 'high' ? 'red' : risk === 'medium' ? 'amber' : 'green';

    let emailResult: { sent: boolean; detail: unknown } | null = null;
    let shouldUpdateAlertSentAt = false;

    if (risk === 'high' || risk === 'medium') {
      const alertCheck = await checkShouldSendAlert(developer_username);
      logs.push({ step: 'alert_check', detail: alertCheck });
      if (alertCheck.shouldSend && team_lead_email) {
        emailResult = await sendEmailAlert(team_lead_email, team_lead_name ?? '', developer_username, analysis, app_url ?? 'https://devpulse.app', logs);
        shouldUpdateAlertSentAt = emailResult?.sent ?? false;
      }
    }

    await upsertDeveloperContext(developer_username, mappedStatus, resolvedTeamId, shouldUpdateAlertSentAt);
    logs.push({ step: 'context_write', detail: { developer_username, status: mappedStatus } });

    return new Response(JSON.stringify({ success: true, analysis, email_sent: emailResult?.sent ?? false, debug_logs: logs }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    logs.push({ step: 'error', detail: error.message });
    return new Response(JSON.stringify({ error: error.message, debug_logs: logs }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
