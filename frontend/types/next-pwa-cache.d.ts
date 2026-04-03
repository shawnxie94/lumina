declare module "next-pwa/cache" {
  const runtimeCaching: Array<{
    urlPattern?: unknown;
    handler?: string;
    method?: string;
    options?: {
      cacheName?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }>;

  export = runtimeCaching;
}
