# Requirements Document

## Introduction

AnchorPoint currently handles SEP-12 KYC document uploads by streaming files through the Express API server using Multer and writing them to local disk. This approach does not scale for large files (e.g., passport scans, proof-of-address PDFs) because it saturates API server memory and bandwidth, and local disk storage is not durable in containerised or cloud deployments.

This feature replaces the direct-upload path with a pre-signed URL strategy. The API server generates short-lived pre-signed URLs pointing to a cloud object-storage bucket (AWS S3 or GCS). The client uploads files directly to cloud storage using those URLs, bypassing the API server for the actual byte transfer. After the upload completes, the client notifies the API server, which records the storage reference and proceeds with KYC submission.

## Glossary

- **AnchorPoint**: The Node.js/TypeScript backend that implements Stellar SEP protocols.
- **SEP-12**: The Stellar Ecosystem Proposal that defines the KYC customer data API used by anchors.
- **KYC_Controller**: The Express controller (`Sep12Controller`) responsible for handling SEP-12 HTTP requests.
- **Upload_Service**: The new service responsible for generating pre-signed URLs and validating completed uploads.
- **Storage_Backend**: The cloud object-storage provider (AWS S3 or GCS) that stores KYC documents.
- **Pre-signed URL**: A time-limited, capability-bearing URL issued by the Storage_Backend that allows a single upload operation without exposing long-lived credentials.
- **Upload_Record**: A Prisma database record that tracks the lifecycle of a single document upload (pending → completed → linked to KYC).
- **KycCustomer**: The existing Prisma model that stores encrypted PII and KYC status for a user.
- **Client**: Any SEP-12-compliant wallet or application that interacts with AnchorPoint.

---

## Requirements

### Requirement 1: Pre-signed URL Generation

**User Story:** As a Client, I want to receive a pre-signed upload URL for each KYC document, so that I can upload files directly to cloud storage without routing large payloads through the API server.

#### Acceptance Criteria

1. WHEN a Client sends a `POST /sep12/customer/upload-url` request with a valid `account`, `field_name`, `content_type`, and `file_size`, THE KYC_Controller SHALL return a pre-signed upload URL and an `upload_id` with HTTP 200.
2. WHEN the `file_size` in the request exceeds the configured maximum (default 20 MB), THE KYC_Controller SHALL return HTTP 400 with an error message identifying the limit.
3. WHEN the `content_type` in the request is not in the configured allowlist (e.g., `image/jpeg`, `image/png`, `application/pdf`), THE KYC_Controller SHALL return HTTP 400 with an error message listing accepted types.
4. WHEN the `account` in the request does not correspond to an authenticated SEP-10 session, THE KYC_Controller SHALL return HTTP 401.
5. THE Upload_Service SHALL generate pre-signed URLs that expire within a configurable duration (default 15 minutes).
6. THE Upload_Service SHALL store an Upload_Record in the database with status `PENDING` at the time of URL generation, containing the `upload_id`, `account`, `field_name`, `storage_key`, and expiry timestamp.

### Requirement 2: Upload Confirmation

**User Story:** As a Client, I want to notify AnchorPoint after a direct upload completes, so that the backend can verify the file exists in storage and associate it with my KYC record.

#### Acceptance Criteria

1. WHEN a Client sends a `POST /sep12/customer/upload-confirm` request with a valid `upload_id` and `account`, THE KYC_Controller SHALL verify the file exists in the Storage_Backend and update the Upload_Record status to `COMPLETED` with HTTP 200.
2. WHEN the file referenced by `upload_id` does not exist in the Storage_Backend at confirmation time, THE KYC_Controller SHALL return HTTP 422 with an error indicating the upload was not found in storage.
3. WHEN the Upload_Record for the given `upload_id` has status `EXPIRED` or does not exist, THE KYC_Controller SHALL return HTTP 404.
4. WHEN the `account` in the confirmation request does not match the `account` on the Upload_Record, THE KYC_Controller SHALL return HTTP 403.
5. THE Upload_Service SHALL verify file existence by performing a metadata-only HEAD request against the Storage_Backend, not by downloading the file content.

### Requirement 3: KYC Submission with Cloud-Stored Documents

**User Story:** As a Client, I want to submit my KYC data referencing previously uploaded documents, so that AnchorPoint can process my identity verification using files stored in cloud storage.

#### Acceptance Criteria

1. WHEN a Client sends a `PUT /sep12/customer` request with one or more `upload_id` values in place of file attachments, THE KYC_Controller SHALL resolve each `upload_id` to its `storage_key` and store the reference in the KycCustomer record.
2. WHEN a `PUT /sep12/customer` request references an `upload_id` whose Upload_Record status is not `COMPLETED`, THE KYC_Controller SHALL return HTTP 400 with an error identifying the unconfirmed upload.
3. WHEN a `PUT /sep12/customer` request references an `upload_id` whose `account` does not match the request `account`, THE KYC_Controller SHALL return HTTP 403.
4. THE KYC_Controller SHALL continue to accept direct file attachments via multipart form-data for backward compatibility with existing Clients that do not use pre-signed URLs.
5. WHEN both a direct file attachment and an `upload_id` are provided for the same `field_name`, THE KYC_Controller SHALL prefer the `upload_id` reference and ignore the direct attachment.

### Requirement 4: Upload Record Expiry

**User Story:** As an operator, I want stale pending upload records to be automatically expired, so that orphaned pre-signed URLs and incomplete uploads do not accumulate in the database.

#### Acceptance Criteria

1. THE Upload_Service SHALL expose an `expireStaleUploads` method that marks all Upload_Records with status `PENDING` and an expiry timestamp in the past as `EXPIRED`.
2. WHEN `expireStaleUploads` is called, THE Upload_Service SHALL return the count of records transitioned to `EXPIRED`.
3. THE Upload_Service SHALL be callable from a scheduled job or admin endpoint without side effects on `COMPLETED` or `REJECTED` records.

### Requirement 5: Storage Backend Abstraction

**User Story:** As a developer, I want the storage integration to be provider-agnostic behind an interface, so that AnchorPoint can switch between AWS S3 and GCS without changing controller or service logic.

#### Acceptance Criteria

1. THE Upload_Service SHALL depend on a `StorageProvider` interface that declares `generatePresignedPutUrl(key, contentType, expiresInSeconds): Promise<string>` and `objectExists(key): Promise<boolean>`.
2. WHERE the `STORAGE_PROVIDER` environment variable is set to `s3`, THE Upload_Service SHALL use the AWS S3 implementation of `StorageProvider`.
3. WHERE the `STORAGE_PROVIDER` environment variable is set to `gcs`, THE Upload_Service SHALL use the GCS implementation of `StorageProvider`.
4. IF the `STORAGE_PROVIDER` environment variable is absent or set to an unsupported value, THEN THE AnchorPoint SHALL log an error and refuse to start.
5. THE `StorageProvider` interface SHALL be the only dependency on cloud-provider SDKs within the Upload_Service; all other service logic SHALL be provider-independent.

### Requirement 6: Configuration and Secrets

**User Story:** As an operator, I want all storage credentials and upload limits to be configurable via environment variables, so that I can deploy AnchorPoint across environments without code changes.

#### Acceptance Criteria

1. THE AnchorPoint SHALL read the following environment variables for storage configuration: `STORAGE_PROVIDER`, `STORAGE_BUCKET`, `STORAGE_REGION` (S3 only), `STORAGE_KEY_PREFIX`, `UPLOAD_MAX_FILE_SIZE_MB`, `UPLOAD_URL_EXPIRY_SECONDS`, and `UPLOAD_ALLOWED_CONTENT_TYPES`.
2. IF any required storage environment variable (`STORAGE_PROVIDER`, `STORAGE_BUCKET`) is absent, THEN THE AnchorPoint SHALL log a descriptive error and exit with a non-zero code at startup.
3. THE AnchorPoint SHALL never log or expose storage credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, GCS service account keys) in HTTP responses or application logs.
4. WHEN `UPLOAD_ALLOWED_CONTENT_TYPES` is not set, THE AnchorPoint SHALL default to allowing `image/jpeg`, `image/png`, and `application/pdf`.

### Requirement 7: Round-trip Storage Key Integrity

**User Story:** As a developer, I want the storage key generated at URL-creation time to be the same key verified at confirmation time, so that there is no mismatch between what was uploaded and what is recorded.

#### Acceptance Criteria

1. THE Upload_Service SHALL generate the `storage_key` deterministically from `account`, `field_name`, and `upload_id` at URL-generation time and persist it in the Upload_Record.
2. WHEN confirming an upload, THE Upload_Service SHALL use the `storage_key` from the Upload_Record — not recompute it from request parameters — to verify file existence in the Storage_Backend.
3. FOR ALL valid Upload_Records, the `storage_key` stored at creation SHALL equal the `storage_key` used during confirmation (round-trip key consistency property).
