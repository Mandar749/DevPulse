const AIRTABLE_API_TOKEN = Deno.env.get('AIRTABLE_API_TOKEN') ?? '';
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

async function airtableFetch(path: string, options: RequestInit) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${AIRTABLE_API_TOKEN}`,
    'Content-Type': 'application/json',
  };
  if (options.headers) {
    for (const [k, v] of Object.entries(options.headers as Record<string, string>)) {
      headers[k] = v;
    }
  }
  return fetch(path, { ...options, headers });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const logs: Array<{ step: string; url?: string; method?: string; body?: unknown; status?: number; response?: unknown }> = [];

  if (!AIRTABLE_API_TOKEN) {
    return new Response(
      JSON.stringify({ error: 'AIRTABLE_API_TOKEN is not set in Supabase secrets', debug_logs: logs }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  try {
    const body = await req.json();
    const { action } = body;

    // CREATE activity event
    if (action === 'create_activity_event') {
      const { developer_username, platform, event_type, timestamp, hour_of_day, is_weekend, commit_message_length, repo_name, team_id } = body;
      const record = { fields: { developer_username, platform, event_type, timestamp, hour_of_day, is_weekend, commit_message_length, repo_name, team_id } };
      const url = airtableUrl(TABLE_ACTIVITY_EVENTS);
      const res = await airtableFetch(url, { method: 'POST', body: JSON.stringify(record) });
      const data = await res.json();
      if (!res.ok) return new Response(JSON.stringify({ error: data.error?.message || 'Create failed', debug_logs: logs }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ success: true, record: data, debug_logs: logs }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // GET activity events
    if (action === 'get_activity_events') {
      const { developer_username, days = 90 } = body;
      const since = new Date();
      since.setDate(since.getDate() - days);
      const filter = `AND({developer_username} = "${developer_username}", {timestamp} >= "${since.toISOString()}")`;
      const url = `${airtableUrl(TABLE_ACTIVITY_EVENTS)}?filterByFormula=${encodeURIComponent(filter)}&sort[0][field]=timestamp&sort[0][direction]=asc`;
      const res = await airtableFetch(url, { method: 'GET' });
      const data = await res.json();
      if (!res.ok) return new Response(JSON.stringify({ error: data.error?.message || 'Fetch failed', debug_logs: logs }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ success: true, records: data.records ?? [], debug_logs: logs }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // GET developer context
    if (action === 'get_developer_context') {
      const { developer_username } = body;
      const filter = `{developer_username} = "${developer_username}"`;
      const url = `${airtableUrl(TABLE_DEVELOPER_CONTEXT)}?filterByFormula=${encodeURIComponent(filter)}&maxRecords=1`;
      const res = await airtableFetch(url, { method: 'GET' });
      const data = await res.json();
      if (!res.ok) return new Response(JSON.stringify({ error: data.error?.message || 'Fetch failed', debug_logs: logs }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const records = data.records ?? [];
      return new Response(JSON.stringify({ success: true, record: records[0] ?? null, debug_logs: logs }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // UPDATE developer context
    if (action === 'update_developer_context') {
      const { developer_username, fields } = body;
      const filter = `{developer_username} = "${developer_username}"`;
      const findUrl = `${airtableUrl(TABLE_DEVELOPER_CONTEXT)}?filterByFormula=${encodeURIComponent(filter)}&maxRecords=1`;
      const findRes = await airtableFetch(findUrl, { method: 'GET' });
      const findData = await findRes.json();
      const records = findData.records ?? [];

      if (records.length > 0) {
        const recordId = records[0].id;
        const url = `${airtableUrl(TABLE_DEVELOPER_CONTEXT)}/${recordId}`;
        const res = await airtableFetch(url, { method: 'PATCH', body: JSON.stringify({ fields }) });
        const data = await res.json();
        if (!res.ok) return new Response(JSON.stringify({ error: data.error?.message || 'Update failed', debug_logs: logs }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        return new Response(JSON.stringify({ success: true, record: data, debug_logs: logs }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } else {
        const url = airtableUrl(TABLE_DEVELOPER_CONTEXT);
        const res = await airtableFetch(url, { method: 'POST', body: JSON.stringify({ fields: { developer_username, ...fields } }) });
        const data = await res.json();
        if (!res.ok) return new Response(JSON.stringify({ error: data.error?.message || 'Create failed', debug_logs: logs }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        return new Response(JSON.stringify({ success: true, record: data, debug_logs: logs }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // LIST all developer context
    if (action === 'list_all_developer_context') {
      const allRecords: Array<Record<string, unknown>> = [];
      let nextUrl: string | null = `${airtableUrl(TABLE_DEVELOPER_CONTEXT)}?pageSize=100`;
      while (nextUrl) {
        const res = await airtableFetch(nextUrl, { method: 'GET' });
        const data = await res.json();
        if (!res.ok) return new Response(JSON.stringify({ error: data.error?.message || 'Fetch failed', debug_logs: logs }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        allRecords.push(...(data.records ?? []));
        nextUrl = data.offset ? `${airtableUrl(TABLE_DEVELOPER_CONTEXT)}?pageSize=100&offset=${encodeURIComponent(data.offset)}` : null;
      }
      return new Response(JSON.stringify({ success: true, records: allRecords, debug_logs: logs }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // GET most recent event
    if (action === 'get_most_recent_event') {
      const { developer_username } = body;
      const filter = `{developer_username} = "${developer_username}"`;
      const url = `${airtableUrl(TABLE_ACTIVITY_EVENTS)}?filterByFormula=${encodeURIComponent(filter)}&sort[0][field]=timestamp&sort[0][direction]=desc&maxRecords=1`;
      const res = await airtableFetch(url, { method: 'GET' });
      const data = await res.json();
      if (!res.ok) return new Response(JSON.stringify({ error: data.error?.message || 'Fetch failed', debug_logs: logs }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const records = data.records ?? [];
      return new Response(JSON.stringify({ success: true, record: records[0] ?? null, debug_logs: logs }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // LIST unique developers
    if (action === 'list_unique_developers') {
      const allRecords: Array<{ fields: { developer_username?: string } }> = [];
      let nextUrl: string | null = `${airtableUrl(TABLE_ACTIVITY_EVENTS)}?fields[]=developer_username&pageSize=100`;
      while (nextUrl) {
        const res = await airtableFetch(nextUrl, { method: 'GET' });
        const data = await res.json();
        if (!res.ok) return new Response(JSON.stringify({ error: data.error?.message || 'Fetch failed', debug_logs: logs }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        allRecords.push(...(data.records ?? []));
        nextUrl = data.offset ? `${airtableUrl(TABLE_ACTIVITY_EVENTS)}?fields[]=developer_username&pageSize=100&offset=${encodeURIComponent(data.offset)}` : null;
      }
      const usernames = Array.from(new Set(allRecords.map((r) => r.fields.developer_username).filter(Boolean))).sort();
      return new Response(JSON.stringify({ success: true, developers: usernames, debug_logs: logs }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // LIST distinct platforms
    if (action === 'list_distinct_platforms') {
      const allRecords: Array<{ fields: { platform?: string; timestamp?: string } }> = [];
      let nextUrl: string | null = `${airtableUrl(TABLE_ACTIVITY_EVENTS)}?fields[]=platform&fields[]=timestamp&pageSize=100`;
      while (nextUrl) {
        const res = await airtableFetch(nextUrl, { method: 'GET' });
        const data = await res.json();
        if (!res.ok) return new Response(JSON.stringify({ error: data.error?.message || 'Fetch failed', debug_logs: logs }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        allRecords.push(...(data.records ?? []));
        nextUrl = data.offset ? `${airtableUrl(TABLE_ACTIVITY_EVENTS)}?fields[]=platform&fields[]=timestamp&pageSize=100&offset=${encodeURIComponent(data.offset)}` : null;
      }
      const platformMap = new Map<string, string>();
      for (const rec of allRecords) {
        const p = rec.fields.platform;
        const ts = rec.fields.timestamp;
        if (!p) continue;
        if (!platformMap.has(p) || (ts && ts > platformMap.get(p)!)) platformMap.set(p, ts || '');
      }
      const platforms = Array.from(platformMap.entries()).map(([name, last_event_at]) => ({ name, last_event_at })).sort((a, b) => a.name.localeCompare(b.name));
      return new Response(JSON.stringify({ success: true, platforms, debug_logs: logs }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // CLEANUP old events
    if (action === 'cleanup_old_events') {
      const { days = 90 } = body;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const filter = `{timestamp} < "${cutoff.toISOString()}"`;
      const url = `${airtableUrl(TABLE_ACTIVITY_EVENTS)}?filterByFormula=${encodeURIComponent(filter)}`;
      const res = await airtableFetch(url, { method: 'GET' });
      const data = await res.json();
      const records = data.records ?? [];
      for (const record of records) {
        await airtableFetch(`${airtableUrl(TABLE_ACTIVITY_EVENTS)}/${record.id}`, { method: 'DELETE' });
      }
      return new Response(JSON.stringify({ success: true, deleted_count: records.length, debug_logs: logs }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Unknown action', debug_logs: logs }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    logs.push({ step: 'error', response: error.message });
    return new Response(
      JSON.stringify({ error: error.message, debug_logs: logs }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
