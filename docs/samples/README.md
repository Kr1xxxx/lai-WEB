# Samples

Mock data only. Every company, person, email address and phone number here is invented (`.example` domains,
555 numbers). **Never put real customer data in this folder** — or anywhere in the repository.

| File | Used by |
| --- | --- |
| `lai-sample-customers.json` | `tests/e2e/harness.mjs` seeds these four customers before each e2e run |
| `whatsapp/*.txt` | `tests/whatsapp-model.test.cjs`, `tests/whatsapp-import.test.cjs`: invented WhatsApp "Export chat" files (Android 24h and 12h, iOS with U+200E / U+202F, Chinese, group chat, ambiguous dates; `+44 7700 900xxx` numbers) |

A larger mock data set (seven lash companies with orders, opportunities, tasks and mails) is the web trial's
`scripts/web-trial/demo-seed.js` and `mail-demo.js`.
