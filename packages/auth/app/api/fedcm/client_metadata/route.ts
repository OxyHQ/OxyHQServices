/**
 * FedCM Client Metadata Endpoint
 *
 * Returns metadata about the client (relying party) to display in the browser UI.
 * This is optional but provides better UX by showing the app's privacy policy and TOS.
 *
 * Spec: https://fedidcg.github.io/FedCM/#idp-api-client-metadata-endpoint
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Get CORS headers for FedCM responses
 * IMPORTANT: When Access-Control-Allow-Credentials is true,
 * Access-Control-Allow-Origin CANNOT be '*' - must be specific origin
 */
function getCorsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get('origin');
  const allowOrigin = origin || 'https://oxy.so';

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Credentials': 'true',
  };
}

export async function GET(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);
  const clientId = request.nextUrl.searchParams.get('client_id');

  if (!clientId) {
    return NextResponse.json(
      { error: 'client_id parameter is required' },
      { status: 400, headers: corsHeaders }
    );
  }

  // Map of known Oxy apps with their metadata
  const clientMetadata: Record<string, any> = {
    'https://homiio.com': {
      privacy_policy_url: 'https://homiio.com/privacy',
      terms_of_service_url: 'https://homiio.com/terms',
    },
    'https://mention.earth': {
      privacy_policy_url: 'https://mention.earth/privacy',
      terms_of_service_url: 'https://mention.earth/terms',
    },
    'https://alia.onl': {
      privacy_policy_url: 'https://alia.onl/privacy',
      terms_of_service_url: 'https://alia.onl/terms',
    },
    'https://oxy.so': {
      privacy_policy_url: 'https://oxy.so/privacy',
      terms_of_service_url: 'https://oxy.so/terms',
    },
    'http://localhost:3000': {
      privacy_policy_url: 'https://oxy.so/privacy',
      terms_of_service_url: 'https://oxy.so/terms',
    },
    'http://localhost:8081': {
      privacy_policy_url: 'https://oxy.so/privacy',
      terms_of_service_url: 'https://oxy.so/terms',
    },
  };

  // Return metadata for the client or default Oxy metadata
  const metadata = clientMetadata[clientId] || {
    privacy_policy_url: 'https://oxy.so/privacy',
    terms_of_service_url: 'https://oxy.so/terms',
  };

  return NextResponse.json(metadata, {
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  const allowOrigin = origin || 'https://oxy.so';

  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Sec-Fetch-Dest',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    },
  });
}
