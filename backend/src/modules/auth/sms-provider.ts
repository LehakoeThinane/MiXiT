import { env } from '../../shared/config/env.js';
import { logger } from '../../shared/utils/logger.js';

type SmsSender = {
  sendOtp: (phone: string, code: string) => Promise<void>;
};

class ConsoleSmsSender implements SmsSender {
  async sendOtp(phone: string, code: string) {
    logger.info('OTP prepared (console sender)', { phone, code });
  }
}

class AfricasTalkingSmsSender implements SmsSender {
  async sendOtp(phone: string, code: string) {
    if (!env.atApiKey || !env.atUsername) {
      throw new Error('Africa\'s Talking credentials are missing');
    }

    const message = `Your MiXiT code is ${code}. Valid for 5 minutes.`;
    const body = new URLSearchParams({
      username: env.atUsername,
      to: phone,
      message,
    });

    if (env.atSenderId) {
      body.set('from', env.atSenderId);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    let response: Response;
    try {
      response = await fetch('https://api.africastalking.com/version1/messaging', {
        method: 'POST',
        headers: {
          apikey: env.atApiKey,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Africa's Talking SMS failed (${response.status}): ${text}`);
    }
  }
}

class SmsPortalSender implements SmsSender {
  private buildAuthorizationHeader() {
    const mode = env.smsportalAuthMode.toLowerCase();

    if (mode === 'bearer') {
      if (!env.smsportalBearerToken) {
        throw new Error('SMSPortal bearer token is missing');
      }
      return `Bearer ${env.smsportalBearerToken}`;
    }

    if (!env.smsportalClientId || !env.smsportalApiSecret) {
      throw new Error('SMSPortal credentials are missing');
    }
    const credentials = Buffer.from(`${env.smsportalClientId}:${env.smsportalApiSecret}`).toString('base64');
    return `Basic ${credentials}`;
  }

  async sendOtp(phone: string, code: string) {
    const message = `Your MiXiT code is ${code}. Valid for 5 minutes.`;
    const endpoint = new URL(env.smsportalSendPath, env.smsportalBaseUrl).toString();
    const payload: {
      messages: Array<{
        content: string;
        destination: string;
        originator?: string;
      }>;
    } = {
      messages: [
        {
          content: message,
          destination: phone,
        },
      ],
    };

    if (env.smsportalOriginator) {
      payload.messages[0].originator = env.smsportalOriginator;
    }

    const authorization = this.buildAuthorizationHeader();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: authorization,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`SMSPortal SMS failed (${response.status}): ${text}`);
    }
  }
}

let smsSenderInstance: SmsSender | null = null;

export function getSmsSender() {
  if (smsSenderInstance) return smsSenderInstance;

  const provider = env.smsProvider.toLowerCase();

  if (provider === 'africastalking') {
    if (!env.atApiKey || !env.atUsername) {
      if (env.nodeEnv === 'production') {
        throw new Error('SMS provider is set to africastalking but credentials are missing');
      }
      logger.warn('Africa\'s Talking credentials missing, falling back to console SMS sender');
      smsSenderInstance = new ConsoleSmsSender();
      return smsSenderInstance;
    }

    smsSenderInstance = new AfricasTalkingSmsSender();
    return smsSenderInstance;
  }

  if (provider === 'smsportal') {
    const authMode = env.smsportalAuthMode.toLowerCase();
    const hasBasicCreds = Boolean(env.smsportalClientId && env.smsportalApiSecret);
    const hasBearerToken = Boolean(env.smsportalBearerToken);
    const credentialsMissing = authMode === 'bearer' ? !hasBearerToken : !hasBasicCreds;

    if (credentialsMissing) {
      if (env.nodeEnv === 'production') {
        throw new Error('SMS provider is set to smsportal but credentials are missing for the selected auth mode');
      }
      logger.warn('SMSPortal credentials missing for selected auth mode, falling back to console SMS sender');
      smsSenderInstance = new ConsoleSmsSender();
      return smsSenderInstance;
    }

    smsSenderInstance = new SmsPortalSender();
    return smsSenderInstance;
  }

  smsSenderInstance = new ConsoleSmsSender();
  return smsSenderInstance;
}
