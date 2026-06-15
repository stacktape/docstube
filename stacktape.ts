import {
  $Secret,
  HostingBucket,
  HttpApiGateway,
  HttpApiIntegration,
  LambdaFunction,
  StacktapeLambdaBuildpackPackaging,
  defineConfig
} from 'stacktape';

const getDomains = (stage: string) => {
  if (stage === 'production') {
    return {
      events: 'events.docstube.dev',
      installs: 'installs.docstube.dev',
      web: ['docstube.dev', 'www.docstube.dev']
    };
  }

  return {
    events: `${stage}-events.docstube.dev`,
    installs: `${stage}-installs.docstube.dev`,
    web: [`${stage}.docstube.dev`]
  };
};

export default defineConfig(({ stage }) => {
  const domains = getDomains(stage);

  const installScripts = new HostingBucket({
    build: {
      command: 'pnpm run release:install-scripts -- --version 0.0.0'
    },
    customDomains: [{ domainName: domains.installs }],
    hostingContentType: 'static-website',
    uploadDirectoryPath: './dist-release/install-scripts'
  });

  const web = new HostingBucket({
    build: {
      command: 'pnpm --filter @docstube/web build'
    },
    customDomains: domains.web.map((domainName) => ({ domainName })),
    hostingContentType: 'static-website',
    uploadDirectoryPath: './apps/web/dist'
  });

  const eventsApi = new HttpApiGateway({
    cors: {
      allowedHeaders: ['content-type'],
      allowedMethods: ['GET', 'POST', 'OPTIONS'],
      allowedOrigins: ['*'],
      enabled: true,
      maxAge: 600
    },
    customDomains: [{ domainName: domains.events }],
    payloadFormat: '2.0'
  });

  const installEvents = new LambdaFunction({
    environment: {
      POSTHOG_HOST: $Secret('docstube-posthog.host'),
      POSTHOG_PROJECT_TOKEN: $Secret('docstube-posthog.projectToken')
    },
    events: [
      new HttpApiIntegration({
        httpApiGatewayName: eventsApi.resourceName,
        method: 'GET',
        path: '/'
      }),
      new HttpApiIntegration({
        httpApiGatewayName: eventsApi.resourceName,
        method: 'POST',
        path: '/v1/install'
      })
    ],
    memory: 256,
    packaging: new StacktapeLambdaBuildpackPackaging({
      entryfilePath: './apps/install-events/src/install-events.ts'
    }),
    runtime: 'nodejs24.x',
    timeout: 5
  });

  return {
    resources: {
      eventsApi,
      installEvents,
      installScripts,
      web
    }
  };
});
