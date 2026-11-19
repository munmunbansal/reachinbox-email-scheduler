import nodemailer from 'nodemailer';

export async function createEtherealSenderAccount() {
  const testAccount = await nodemailer.createTestAccount();
  return {
    email: testAccount.user,
    etherealUser: testAccount.user,
    etherealPass: testAccount.pass,
  };
}

export function getTransporter(etherealUser: string, etherealPass: string) {
  return nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user: etherealUser,
      pass: etherealPass,
    },
  });
}