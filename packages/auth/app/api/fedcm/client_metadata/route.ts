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

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get('client_id');

  if (!clientId) {
    return NextResponse.json(
      { error: 'client_id parameter is required' },
      { status: 400 }
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
      'Access-Control-Allow-Origin': request.headers.get('origin') || '*',
      'Access-Control-Allow-Credentials': 'true',
    },
  });
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': request.headers.get('origin') || '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    },
  });
}
