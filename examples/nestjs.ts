import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { VerificationResult } from "reqkey";
import { ReqKeyDecision, ReqKeyModule } from "reqkey/nestjs";

@Controller("payments")
class PaymentsController {
  @Get()
  list(@ReqKeyDecision() decision: VerificationResult | undefined) {
    return {
      payments: [],
      creditsRemaining: decision?.creditsRemaining,
    };
  }
}

@Module({
  imports: [
    ReqKeyModule.forRoot({
      projectKey: process.env.REQKEY_PROJECT_KEY,
      apiId: "api_payments",
      mode: "both",
      keyName: "X-StartupName-Key",
      excludePaths: ["/health"],
    }),
  ],
  controllers: [PaymentsController],
})
class AppModule {}

const app = await NestFactory.create(AppModule);
await app.listen(3000);
