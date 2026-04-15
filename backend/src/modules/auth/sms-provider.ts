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

    const response = await fetch('https://api.africastalking.com/version1/messaging', {
      method: 'POST',
      headers: {
        apikey: env.atApiKey,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Africa's Talking SMS failed (${response.status}): ${text}`);
    }
  }
}

let smsSenderInstance: SmsSender | null = null;

export function getSmsSender() {
  if (smsSenderInstance) return smsSenderInstance;

  if (env.smsProvider === 'africastalking') {
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

  smsSenderInstance = new ConsoleSmsSender();
  return smsSenderInstance;
}
