#!/bin/bash
# Quick CORS Configuration for DigitalOcean Spaces

# This script configures CORS on your DigitalOcean Space to allow direct uploads from browsers

SPACE_NAME="oxy-development-bucket"
SPACE_REGION="ams3"
ENDPOINT="https://${SPACE_REGION}.digitaloceanspaces.com"

# Create CORS configuration file
cat > /tmp/spaces-cors.xml << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <CORSRule>
    <AllowedOrigin>*</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>POST</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>DELETE</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <ExposeHeader>x-amz-request-id</ExposeHeader>
    <ExposeHeader>x-amz-id-2</ExposeHeader>
    <ExposeHeader>Access-Control-Allow-Origin</ExposeHeader>
  </CORSRule>
</CORSConfiguration>
EOF

echo "CORS configuration created at /tmp/spaces-cors.xml"
echo ""
echo "To apply this configuration, use ONE of these methods:"
echo ""
echo "METHOD 1: Using AWS CLI"
echo "========================"
echo "aws s3api put-bucket-cors \\"
echo "  --bucket ${SPACE_NAME} \\"
echo "  --endpoint-url ${ENDPOINT} \\"
echo "  --cors-configuration file:///tmp/spaces-cors.xml"
echo ""
echo "METHOD 2: Using s3cmd"
echo "====================="
echo "s3cmd setcors /tmp/spaces-cors.xml s3://${SPACE_NAME} --host=${ENDPOINT##https://} --host-bucket='%(bucket)s.${ENDPOINT##https://}'"
echo ""
echo "METHOD 3: DigitalOcean Web Console"
echo "==================================="
echo "1. Go to: https://cloud.digitalocean.com/spaces"
echo "2. Select space: ${SPACE_NAME}"
echo "3. Click 'Settings' tab"
echo "4. Scroll to 'CORS Configurations'"
echo "5. Click 'Add' and paste the content from /tmp/spaces-cors.xml"
echo ""
echo "After applying, test with:"
echo "curl -X OPTIONS \\"
echo "  ${ENDPOINT}/test.jpg \\"
echo "  -H 'Origin: http://localhost:8081' \\"
echo "  -H 'Access-Control-Request-Method: PUT' \\"
echo "  -v"
