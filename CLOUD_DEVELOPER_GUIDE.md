# Predict GCP Cloud Migration — Developer Handover Guide

**GCP Project ID**: `predict-trading-0904`  
**GCP Project Name**: Predict Trading App  
**Primary Account**: `senthil930@gmail.com`  
**Live Production Service URL**: `https://predict-cloud-api-428463178740.us-east1.run.app`  

---

## 1. GCP Architecture Summary

The Cloud Backend decouples the Predict iOS app from on-device trading loops.
- **Compute**: Node.js 22 TypeScript standalone bundle running on **GCP Cloud Run** (`predict-cloud-api`).
- **Vault**: **GCP Secret Manager** with **Cloud KMS** envelope encryption storing encrypted Kalshi API Key IDs & RSA Private Key PEM files per user.
- **Database**: **GCP Firestore (Native Mode)** storing multi-tenant user documents, settings, trade execution history, and immutable security audit logs.
- **Tick Scheduler**: **Cloud Scheduler** (`predict-20s-tick-job`) triggering `/tick` on `https://predict-cloud-api-428463178740.us-east1.run.app/tick`.
- **Alert Dispatch**: Push notifications sent via **Expo Push API / APNs** to iOS devices.

---

## 2. Direct GCP Project Console Links

Here are the direct links to view all live resources for **`predict-trading-0904`**:

| GCP Service | Direct Project Console Link | Description / Live Endpoint |
|---|---|---|
| **Cloud Run Service** | [https://console.cloud.google.com/run/detail/us-east1/predict-cloud-api/general?project=predict-trading-0904](https://console.cloud.google.com/run/detail/us-east1/predict-cloud-api/general?project=predict-trading-0904) | `https://predict-cloud-api-428463178740.us-east1.run.app` |
| **Firestore Database** | [https://console.cloud.google.com/firestore/databases?project=predict-trading-0904](https://console.cloud.google.com/firestore/databases?project=predict-trading-0904) | `(default)` Native Mode Database |
| **Secret Manager** | [https://console.cloud.google.com/security/secret-manager?project=predict-trading-0904](https://console.cloud.google.com/security/secret-manager?project=predict-trading-0904) | `predict-user-{userId}-kalshi-key` |
| **Cloud Scheduler** | [https://console.cloud.google.com/cloudscheduler?project=predict-trading-0904](https://console.cloud.google.com/cloudscheduler?project=predict-trading-0904) | `predict-20s-tick-job` (`POST /tick`) |
| **Cloud Logging** | [https://console.cloud.google.com/logs/query?project=predict-trading-0904](https://console.cloud.google.com/logs/query?project=predict-trading-0904) | Log Explorer (`resource.type="cloud_run_revision"`) |
| **API Dashboard** | [https://console.cloud.google.com/apis/dashboard?project=predict-trading-0904](https://console.cloud.google.com/apis/dashboard?project=predict-trading-0904) | Enabled GCP APIs |
| **IAM & Service Accounts** | [https://console.cloud.google.com/iam-admin/serviceaccounts?project=predict-trading-0904](https://console.cloud.google.com/iam-admin/serviceaccounts?project=predict-trading-0904) | Service Accounts & Permissions |

---

## 3. Live Endpoints Reference

Base URL: `https://predict-cloud-api-428463178740.us-east1.run.app`

| HTTP Method | Route | Description | Auth Required |
|---|---|---|---|
| `GET` | `/me/status` | Live status & configuration query | Bearer Token (Apple ID) |
| `POST` | `/me/status` | Updates cloud trading status / config | Bearer Token (Apple ID) |
| `POST` | `/me/kalshi/credentials` | Uploads RSA PEM + Key ID to Secret Manager | Bearer Token (Apple ID) |
| `DELETE` | `/me/kalshi/credentials` | Permanently deletes credentials from Secret Manager | Bearer Token (Apple ID) |
| `POST` | `/me/execution/kill` | Triggers Emergency Kill Switch instantly | Bearer Token (Apple ID) |
| `POST` | `/me/push-token` | Registers Expo Push token | Bearer Token (Apple ID) |
| `GET` | `/me/trades` | Retrieves trade execution history | Bearer Token (Apple ID) |
| `GET` | `/me/audit` | Retrieves security audit log | Bearer Token (Apple ID) |
| `POST` | `/tick` | 20s Cloud Scheduler tick trigger | Cloud Scheduler Job |
