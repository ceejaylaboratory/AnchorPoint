-- AlterTable: structured audit log fields
ALTER TABLE "AdminConfigAuditLog" ADD COLUMN "ipAddress" TEXT;
ALTER TABLE "AdminConfigAuditLog" ADD COLUMN "result" TEXT NOT NULL DEFAULT 'success';

-- Enforce append-only semantics: reject any UPDATE or DELETE on audit entries
CREATE OR REPLACE FUNCTION "prevent_admin_audit_log_mutation"() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'AdminConfigAuditLog is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AdminConfigAuditLog_append_only"
BEFORE UPDATE OR DELETE ON "AdminConfigAuditLog"
FOR EACH ROW EXECUTE FUNCTION "prevent_admin_audit_log_mutation"();
