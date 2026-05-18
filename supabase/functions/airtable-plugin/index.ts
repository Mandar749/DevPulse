import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const AIRTABLE_API_TOKEN = Deno.env.get('AIRTABLE_API_TOKEN') ?? '';
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET') ?? '';
const AIRTABLE_BASE_ID = 'appT1VTAFxjHdkKn2';
const TABLE_ACTIVITY_EVENTS = 'tblZgCdLi1X34Hbng';
const TABLE_DEVELOPER_CONTEXT = 'tbl82g1bm9Soet9Sg';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function airtableUrl(tableId: string) {
  return `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}`;
}

async function verifyGitHubSignature(rawBody: Uint8Array, signature: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = await crypto.subtle.sign('HMAC', key, rawBody);
  const expected = 'sha256=' + Array.from(new Uint8Array(signed))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return signature === expected;
}

function getEventType(payload: Record<string, unknown>): string {
  if (payload.ref_type === 'tag') return 'tag_created';
  if (payload.pull_request) {
    const pr = payload.pull_request as Record<string, unknown>;
    if (pr.merged) return 'pr_merged';
    const action = String(payload.action ?? '');
    if (action === 'review_requested' || action === 'submitted') return 'pr_reviewed';
    if (action === 'opened' || action === 'synchronize') return 'pr_opened';
    if (action === 'closed') return 'pr_closed';
    return 'pr_opened';
  }
  if (payload.review) return 'pr_reviewed';
  if (payload.issue) return 'issue_response';
  if (payload.commits || payload.head_commit) return 'commit';
  return 'unknown';
}

function getUsername(payload: Record<string, unknown>): string {
  if (typeof payload.sender === 'object' && payload.sender !== null) {
    const sender = payload.sender as Record<string, unknown>;
    if (sender.login) return String(sender.login);
  }
  if (Array.isArray(payload.commits) && payload.commits.length > 0) {
    const commit = payload.commits[0] as Record<string, unknown>;
    if (typeof commit.author === 'object' && commit.author !== null) {
      const author = commit.author as Record<string, unknown>;
      if (author.username) return String(author.username);
    }
  }
  if (typeof payload.pusher === 'object' && payload.pusher !== null) {
    const pusher = payload.pusher as Record<string, unknown>;
    if (pusher.name) return String(pusher.name);
  }
  return 'unknown';
}

function getRepoName(payload: Record<string, unknown>): string {
  if (typeof payload.repository === 'object' && payload.repository !== null) {
    const repo = payload.repository as Record<string, unknown>;
    if (repo.name) return String(repo.name);
  }
  return '';
}

function getCommitMessageLength(payload: Record<string, unknown>): number {
  let msg = '';
  if (typeof payload.head_commit === 'object' && payload.head_commit !== null) {
    const hc = payload.head_commit as Record<string, unknown>;
    if (hc.message) msg = String(hc.message);
  }
  if (!msg && Array.isArray(payload.commits) && payload.commits.length > 0) {
    const commit = payload.commits[0] as Record<string, unknown>;
    if (commit.message) msg = String(commit.message);
  }
  return msg.length;
}

function getTimestamp(payload: Record<string, unknown>): string {
  if (typeof payload.head_commit === 'object' && payload.head_commit !== null) {
    const hc = payload.head_commit as Record<string, unknown>;
    if (hc.timestamp) return String(hc.timestamp);
  }
  if (Array.isArray(payload.commits) && payload.commits.length > 0) {
    const commit = payload.commits[0] as Record<string, unknown>;
    if (commit.timestamp) return String(commit.timestamp);
  }
  return new Date().toISOString();
}

async function createAirtableActivityEvent(
  developer_username: string,
  platform: string,
  event_type: string,
  timestamp: string,
  hour_of_day: number,
  is_weekend: boolean,
  repo_name: string,
  commit_message_length: number,
  team_id: string,
) {
  const res = await fetch(airtableUrl(TABLE_ACTIVITY_EVENTS), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        developer_username,
        platform,
        event_type,
        timestamp,
        hour_of_day,
        is_weekend,
        repo_name,
        commit_message_length,
        team_id,
      },
    }),
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

async function upsertDeveloperContext(
  developerUsername: string,
  status: string,
  teamId: string,
): Promise<{ created: boolean; ok: boolean; detail: unknown }> {
  const filter = `{developer_username} = "${developerUsername}"`;
  const findUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${TABLE_DEVELOPER_CONTEXT}?filterByFormula=${encodeURIComponent(filter)}&maxRecords=1`;

  const findRes = await fetch(findUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${AIRTABLE_API_TOKEN}`, 'Content-Type': 'application/json' },
  });
  const findData = await findRes.json();
  const records = findData.records ?? [];
  const nowIso = new Date().toISOString();

  if (records.length === 0) {
    const createRes = await fetch(airtableUrl(TABLE_DEVELOPER_CONTEXT), {
      method: 'POST',
      headers: { Authorization: `Bearer ${AIRTABLE_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { developer_username: developerUsername, team_id: teamId, status, alert_sent_at: nowIso } }),
    });
    const createData = await createRes.json().catch(() => ({}));
    return { created: true, ok: createRes.ok, detail: { status: createRes.status, body: createData } };
  }

  const recordId = records[0].id;
  const patchRes = await fetch(airtableUrl(TABLE_DEVELOPER_CONTEXT), {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${AIRTABLE_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [{ id: recordId, fields: { status, alert_sent_at: nowIso } }] }),
  });
  const patchData = await patchRes.json().catch(() => ({}));
  return { created: false, ok: patchRes.ok, detail: { status: patchRes.status, body: patchData } };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const logs: Array<{ step: string; detail?: unknown }> = [];

  try {
    const rawBytes = new Uint8Array(await req.arrayBuffer());
    const rawBody = new TextDecoder().decode(rawBytes);
    const signature = req.headers.get('X-Hub-Signature-256') ?? '';

    if (WEBHOOK_SECRET) {
      if (!signature) {
        return new Response(
          JSON.stringify({ error: 'Missing X-Hub-Signature-256 header', debug_logs: logs }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      const valid = await verifyGitHubSignature(rawBytes, signature, WEBHOOK_SECRET);
      if (!valid) {
        return new Response(
          JSON.stringify({ error: 'Invalid webhook signature', debug_logs: logs }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    let payloadJson: Record<string, unknown>;
    try {
      payloadJson = JSON.parse(rawBody);
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON payload', debug_logs: logs }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const url = new URL(req.url);
    const team_id = url.searchParams.get('team_id') ?? 'team-001';
    const developer_username = getUsername(payloadJson);
    const event_type = getEventType(payloadJson);
    const timestamp = getTimestamp(payloadJson);
    const date = new Date(timestamp);
    const hour_of_day = date.getHours();
    const is_weekend = date.getDay() === 0 || date.getDay() === 6;
    const commit_message_length = getCommitMessageLength(payloadJson);
    const repo_name = getRepoName(payloadJson);

    logs.push({ step: 'fields_extracted', detail: { developer_username, event_type, timestamp, hour_of_day, is_weekend, commit_message_length, repo_name, team_id } });

    const airtableRes = await createAirtableActivityEvent(developer_username, 'GitHub', event_type, timestamp, hour_of_day, is_weekend, repo_name, commit_message_length, team_id);
    logs.push({ step: 'airtable_write', detail: { ok: airtableRes.ok, status: airtableRes.status } });

    const ctxRes = await upsertDeveloperContext(developer_username, 'green', team_id);
    logs.push({ step: 'context_check', detail: { created: ctxRes.created, ok: ctxRes.ok } });

    return new Response(
      JSON.stringify({ received: true, debug_logs: logs }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    logs.push({ step: 'error', detail: error.message });
    return new Response(
      JSON.stringify({ error: error.message, debug_logs: logs }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
