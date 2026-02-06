/**
 * FedCM Client Metadata Endpoint
 *
 * Returns metadata about the client (relying party) to display in the browser UI.
 * This is optional but provides better UX by showing the app's privacy policy and TOS.
 *
 * Spec: https://fedidcg.github.io/FedCM/#idp-api-client-metadata-endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFedCMCorsHeaders, getFedCMPreflightHeaders } from '@/lib/fedcm-cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Known Oxy ecosystem apps with specific metadata.
// Unknown clients get default Oxy policies.
const clientMetadata: Record<string, { privacy_policy_url: string; terms_of_service_url: string }> = {
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
};

const defaultMetadata = {
  privacy_policy_url: 'https://oxy.so/privacy',
  terms_of_service_url: 'https://oxy.so/terms',
};

export async function GET(request: NextRequest) {
  const corsHeaders = getFedCMCorsHeaders(request);
  const clientId = request.nextUrl.searchParams.get('client_id');

  if (!clientId) {
    return NextResponse.json(
      { error: 'client_id parameter is required' },
      { status: 400, headers: corsHeaders }
    );
  }

  const metadata = clientMetadata[clientId] || defaultMetadata;

  return NextResponse.json(metadata, {
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

export async function OPTIONS(request: NextRequest) {
  const headers = getFedCMPreflightHeaders(request, 'GET, OPTIONS', 'Content-Type, Sec-Fetch-Dest');
  return new NextResponse(null, { status: 204, headers });
}
