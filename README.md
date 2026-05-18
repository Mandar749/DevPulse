# DevPulse — Developer Wellbeing Intelligence Agent

> Catch burnout before it catches your team.

Built for the **Build with MeDo Hackathon 2026** | #BuiltWithMeDo

---

## The Problem

Burnout is invisible until someone quits. 83% of software developers experience workplace burnout, and by the time a manager notices the signs, it's often too late. The behavioral signals were always there — in commit timestamps, message lengths, review participation — but no tool was watching.

**DevPulse watches.**

---

## What It Does

DevPulse is an automated developer wellbeing intelligence agent that:

- Connects to Git platforms teams already use via **webhooks** — GitHub, Gitee, GitLab, CODING, Alibaba Codeup
- Monitors behavioral signals automatically — no developer friction, no manual input
- Uses **AI (Google Gemini)** to reason over patterns, comparing each developer against their **own** baseline
- Surfaces a **private, empathetic nudge** to the team lead when a cluster of signals warrants a check-in
- Sends **formatted email alerts** via Resend with 14-day anti-spam logic
- Lets developers **self-report** context (vacation, sprint, personal) to suppress alerts

No surveillance. No diagnosis. No ranking. Just a timely, informed heads-up.

---

## Sample Alert

> "Hey, you may want to casually check in with dev_john. Over the past 3 weeks, their commit activity has dropped significantly, they've been pushing commits past midnight consistently — outside their usual pattern, and commit messages have become very short. A simple check-in might help."

---

## Tech Stack

| Layer | Technology |
|---|---|
| App Builder | MeDo (entire frontend + backend via conversation) |
| Frontend | React, TypeScript, Tailwind CSS |
| Backend | Supabase Edge Functions (Deno) |
| Database | Airtable |
| AI / LLM | Google Gemini 2.5 Flash |
| Email | Resend |
| Webhooks | GitHub, Gitee, GitLab, CODING, Alibaba Codeup |
| Security | HMAC-SHA256 webhook signature verification |

---

## Architecture

```
Git Platform (GitHub / Gitee / GitLab / CODING / Codeup)
        |
        | Webhook (push, PR, review events)
        ↓
webhook-receiver Edge Function
        |
        ↓
Airtable — activity_events table (persistent storage)
        |
        ↓
llm-analyze Edge Function
        |
        ↓
Google Gemini — pattern reasoning over behavioral metadata
        |
        ↓
Private email alert → Team Lead (via Resend)
        |
        ↓
DevPulse Dashboard — developer status badges updated
```

---

## Signals Monitored

| Signal | What It Detects |
|---|---|
| Commit frequency | Prolonged silence vs. personal baseline |
| Commit timing | Consistent late-night or weekend work |
| Commit message length | Short, terse messages over time |
| PR review participation | Withdrawal from team activity |
| Event clustering | Combinations of signals, not single events |

---

## How False Alarms Are Avoided

- **Cluster detection** — one quiet week = nothing; 3 weeks of combined signals = flag
- **Personal baseline** — compared against the individual's own history, never team average
- **Recovery detection** — bouncing back = no alert sent
- **Self-reporting** — developers can suppress alerts for any period
- **14-day anti-spam** — no repeated alerts for the same developer

---

## Privacy & Ethics

- Only **behavioral metadata** collected — never code content
- Alerts visible **only to the team lead** — never HR, executives, or peers
- Every alert states it is a **signal for human review, not a diagnosis**
- Developers can **self-report context** to suppress alerts
- **PIPL (China), GDPR (EU), India DPDP Act** principles applied
- Developers compared against **their own baseline only** — never ranked against teammates

---

## Supabase Edge Functions

This repo contains the three backend Edge Functions powering DevPulse:

### `webhook-receiver/index.ts`
Receives webhook payloads from Git platforms. Verifies HMAC-SHA256 signatures, extracts behavioral fields, and writes records to Airtable.

### `airtable-plugin/index.ts`
Handles all Airtable CRUD operations — activity events, developer context, platform deduplication, and cleanup.

### `llm-analyze/index.ts`
Fetches activity records, checks suppression status, builds behavioral prompt, calls Gemini for pattern analysis, generates check-in message, and sends email alert via Resend.

---

## Environment Variables (Supabase Secrets)

| Secret | Description |
|---|---|
| `AIRTABLE_API_TOKEN` | Airtable Personal Access Token |
| `GEMINI_API_KEY` | Google Gemini API Key |
| `RESEND_API_KEY` | Resend API Key for email delivery |
| `WEBHOOK_SECRET` | HMAC secret for webhook verification (`devpulse2026`) |

---

## Airtable Schema

### `activity_events`
| Field | Type | Description |
|---|---|---|
| developer_username | Text | Git platform username |
| platform | Select | GitHub / Gitee / GitLab / CODING / Codeup |
| event_type | Select | commit / pr_opened / pr_reviewed / issue_response |
| timestamp | DateTime | When the event occurred |
| hour_of_day | Number | 0–23, for late-night detection |
| is_weekend | Checkbox | Saturday or Sunday |
| commit_message_length | Number | Character count |
| repo_name | Text | Repository name |
| team_id | Text | Team identifier |

### `developer_context`
| Field | Type | Description |
|---|---|---|
| developer_username | Text | Git platform username |
| team_id | Text | Team identifier |
| status | Select | green / amber / red |
| alert_sent_at | DateTime | Last alert timestamp (14-day guard) |
| suppress_until | Date | Self-report suppression end date |
| suppress_reason | Text | Vacation / Sprint / Personal / Other |

---

## Supported Platforms

| Platform | Region | Notes |
|---|---|---|
| GitHub | Global | Most common, full webhook support |
| Gitee (码云) | China | China's #1 Git platform, ~25M developers |
| GitLab | Global | Enterprise and self-hosted |
| CODING (Tencent) | China | Widely used in Chinese enterprises |
| Alibaba Codeup | China | Enterprise DevOps |

---

## Built With MeDo

DevPulse was built entirely through [MeDo](https://medo.dev)'s conversation-to-app platform. No code was written manually — every screen, Edge Function, and integration was generated by describing requirements in plain language across five focused sessions.

**#BuiltWithMeDo**

---

## What's Next

- Team-level burnout dashboard for Engineering Managers
- Workload rebalancing suggestions before burnout hits
- Calendar integration to factor in meeting load
- Baidu ERNIE as primary AI model for Chinese enterprise customers
- Predictive attrition scoring over 6-month rolling windows
- Extension to QA, DevOps, and other Git-adjacent roles

---

*DevPulse — Built with MeDo | Build with MeDo Hackathon 2026*
