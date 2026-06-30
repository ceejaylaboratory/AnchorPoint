# SEP-12 Large File Uploads: S3 and GCS Setup Guide

AnchorPoint uses pre-signed URLs so clients upload KYC documents directly to cloud storage, bypassing the API server. This document covers CORS configuration for AWS S3 and Google Cloud Storage (GCS).

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `STORAGE_PROVIDER` | Yes | — | `s3` or `gcs` |
| `STORAGE_BUCKET` | Yes | — | Bucket name |
| `STORAGE_REGION` | S3 only | — | AWS region (e.g. `us-east-1`) |
| `STORAGE_KEY_PREFIX` | No | `kyc` | Path prefix for all uploaded objects |
| `UPLOAD_MAX_FILE_SIZE_MB` | No | `20` | Maximum upload size in MB |
| `UPLOAD_URL_EXPIRY_SECONDS` | No | `900` | Pre-signed URL lifetime (15 min) |
| `UPLOAD_ALLOWED_CONTENT_TYPES` | No | `image/jpeg,image/png,application/pdf` | Comma-separated allowlist |

> **Note**: Never commit `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, or GCS service-account JSON to source control.

---

## AWS S3

### Bucket CORS Configuration

Apply via the AWS Console → S3 → your bucket → Permissions → CORS, or with the CLI:

```bash
aws s3api put-bucket-cors \
  --bucket YOUR_BUCKET \
  --cors-configuration '{
    "CORSRules": [
      {
        "AllowedOrigins": ["https://your-anchor-domain.com"],
        "AllowedMethods": ["PUT"],
        "AllowedHeaders": ["Content-Type", "Content-Length"],
        "ExposeHeaders": ["ETag"],
        "MaxAgeSeconds": 3600
      }
    ]
  }'
```

Replace `https://your-anchor-domain.com` with the origin of your dashboard. For local development you can use `http://localhost:3000`.

### IAM Policy

The backend needs only `s3:PutObject` (for generating pre-signed PUT URLs) and `s3:HeadObject` (for upload confirmation):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:HeadObject"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET/kyc/*"
    }
  ]
}
```

### Environment Variables (S3)

```env
STORAGE_PROVIDER=s3
STORAGE_BUCKET=your-kyc-bucket
STORAGE_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

Use an IAM role instead of static credentials whenever possible (e.g. ECS task roles, EC2 instance profiles).

---

## Google Cloud Storage (GCS)

### Bucket CORS Configuration

Save the following as `cors.json` and apply with `gsutil`:

```json
[
  {
    "origin": ["https://your-anchor-domain.com"],
    "method": ["PUT"],
    "responseHeader": ["Content-Type", "Content-Length"],
    "maxAgeSeconds": 3600
  }
]
```

```bash
gsutil cors set cors.json gs://YOUR_BUCKET
```

### Service Account Permissions

Grant the service account the `roles/storage.objectCreator` role (for generating signed URLs and uploading) and `roles/storage.objectViewer` (for `objectExists` HEAD checks):

```bash
gcloud storage buckets add-iam-policy-binding gs://YOUR_BUCKET \
  --member="serviceAccount:anchorpoint@YOUR_PROJECT.iam.gserviceaccount.com" \
  --role="roles/storage.objectCreator"

gcloud storage buckets add-iam-policy-binding gs://YOUR_BUCKET \
  --member="serviceAccount:anchorpoint@YOUR_PROJECT.iam.gserviceaccount.com" \
  --role="roles/storage.objectViewer"
```

### Environment Variables (GCS)

```env
STORAGE_PROVIDER=gcs
STORAGE_BUCKET=your-kyc-bucket
GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/gcs-key.json
```

---

## Testing the Upload Flow

1. **Request a pre-signed URL**:
   ```bash
   curl -X POST http://localhost:3002/sep12/customer/upload-url \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{"account":"G...","field_name":"id_photo_front","content_type":"image/jpeg","file_size":512000}'
   ```

2. **Upload directly to storage** using the returned `url`:
   ```bash
   curl -X PUT "$PRESIGNED_URL" \
     -H "Content-Type: image/jpeg" \
     --data-binary @passport.jpg
   ```

3. **Confirm the upload**:
   ```bash
   curl -X POST http://localhost:3002/sep12/customer/upload-confirm \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{"upload_id":"<upload_id from step 1>","account":"G..."}'
   ```
