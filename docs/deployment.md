# Cloud Setup & Deployment

This document describes how to deploy the Astro application and its Edge Function backend to **Tencent Cloud EdgeOne**, including setup details for both Layer 1 (CDN POP Cache) and Layer 2 (Edge KV Store) caching mechanisms.

## 1. EdgeOne Pages Configuration

1. Log in to the **Tencent Cloud EdgeOne Console** and select your project.
2. Navigate to **EdgeOne Pages** and link your Git repository.
3. Configure the build parameters:
   * **Node Version:** `22.12.0` (or higher)
   * **Build Command:** `pnpm build`
   * **Output Directory:** `dist`
4. Deploy the project. This will provision your default deployment domain (e.g., `exchange-hzbtsyen.edgeone.dev`).

## 2. Layer 1: Edge CDN POP Cache Setup

By default, EdgeOne does not cache serverless Pages functions on default `*.edgeone.dev` domains. To enable L1 caching at the edge node POP layer, you must configure a custom domain and set a Rule Engine policy.

### Step A: Add Custom Domain & Avoid CDN Loops
1. Navigate to **Domain Management > Web Acceleration** and add your custom domain (e.g., `exchange.mvc.my.id`).
2. Configure the **Origin-pull Configuration** settings as follows:
   * **Origin settings (IP/Domain name):** Enter your default Pages domain (e.g., `exchange-hzbtsyen.edgeone.dev`).
   * **Origin protocol:** `Follow protocol` or `HTTPS`.
   * **Origin HOST header:** Change from `Use acceleration` to **`Use origin domain name`**. 
     > [!IMPORTANT]
     > Setting the Origin HOST header to "Use origin domain name" is critical. If left as "Use acceleration", it will send the custom domain host header back to the CDN IP, creating an infinite `cdn-loop: TencentEdgeOne; loops=16` lookup loop.
3. Complete the configuration, copy the generated CNAME record, and add it to your DNS provider's zone file.

### Step B: Import Cache Rule (Rule Engine)
Navigate to your domain's **Rule Engine** panel. You can configure this visually in the console or import the JSON structure directly.

#### Visual UI Steps
1. Add a conditional block: **If `URL path` `is in` `/api/rates`**.
2. Add Action: **`EdgeOne Node Cache`** -> Set behavior to **`Follow Origin`**.
3. Add Action: **`Browser Cache TTL`** -> Set behavior to **`Follow Origin`**.
4. Deploy the rule.

#### JSON Configuration Import Syntax
If using the version history or JSON config exporter, insert the following block under your `"Rules"` list:

```json
{
  "FormatVersion": "1.0",
  "Rules": [
    {
      "RuleName": "Cache Rates API",
      "Branches": [
        {
          "Condition": "${http.request.uri.path} in ['/api/rates']",
          "Actions": [
            {
              "Name": "Cache",
              "CacheParameters": {
                "FollowOrigin": {
                  "Switch": "on",
                  "DefaultCache": "off",
                  "DefaultCacheStrategy": "off",
                  "DefaultCacheTime": 0
                }
              }
            },
            {
              "Name": "MaxAge",
              "MaxAgeParameters": {
                "FollowOrigin": "on",
                "CacheTime": 0
              }
            }
          ]
        }
      ],
      "Description": []
    }
  ]
}
```

## 3. Layer 2: Edge KV Setup (Global Persistent Caching)

To protect the upstream Frankfurter API from rate limit exhaustion and maintain edge execution when the origin API is down:

1. In the EdgeOne Console, navigate to **Edge Key-Value (KV)**.
2. Click **Create Namespace** and create a store (e.g., named `CURRENCY_STORE`).
3. Return to **EdgeOne Pages**, select your project, and navigate to **Settings > Function Bindings**.
4. Bind your newly created KV namespace to the variable name **`EXCHANGE_STORE`**.
5. Redeploy your application. The Edge Function will automatically detect the KV namespace binding and start using it.

## 4. Environment Variables

Configure these settings inside the **Environment Variables** section of your Pages project settings:

| Variable | Default | Description |
| --- | --- | --- |
| `DISABLE_API` | `false` | Master kill-switch. When `true`, returns `503 Service Unavailable`, forcing the client UI to fallback to client-side fetches. |
| `DISABLE_KV` | `false` | Bypasses Edge KV reads and writes completely, relying solely on L1 CDN Cache memory. |
| `DISABLE_CDN_CACHE` | `false` | Disables L1 POP caching headers, forcing `Cache-Control: no-store`. |
