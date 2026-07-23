import Koa from "koa";
import reqkey from "reqkey/koa";

const app = new Koa();

app.use(
  reqkey({
    projectKey: process.env.REQKEY_PROJECT_KEY,
    apiId: "api_payments",
    mode: "both",
    keyName: "X-StartupName-Key",
    excludePaths: ["/health"],
  }),
);

app.use((context) => {
  context.status = 201;
  context.body = {
    created: true,
    creditsRemaining: context.state.reqkey?.creditsRemaining,
  };
});

app.listen(3000);
