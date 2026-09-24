/**
 * Validates the generated OpenAPI 3.0 spec (#1205).
 *
 * Fails when any @swagger JSDoc block contains invalid YAML or when the
 * assembled document does not conform to the OpenAPI 3.0 schema.
 *
 * Usage (from backend/): npm run swagger:validate
 */
import swaggerJsdoc from 'swagger-jsdoc';
import SwaggerParser from '@apidevtools/swagger-parser';
import { swaggerOptions } from '../src/config/swagger';

async function main(): Promise<void> {
  const spec = swaggerJsdoc({ ...swaggerOptions, failOnErrors: true }) as Record<string, unknown>;
  const api = await SwaggerParser.validate(JSON.parse(JSON.stringify(spec)));
  const pathCount = Object.keys(api.paths ?? {}).length;
  console.log(`OpenAPI spec is valid (${pathCount} paths).`);
}

main().catch((error) => {
  console.error('OpenAPI spec validation failed:');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
