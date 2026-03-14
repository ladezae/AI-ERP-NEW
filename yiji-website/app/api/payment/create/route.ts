import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// 綠界 ECPay 金流串接
// 文件：https://developers.ecpay.com.tw/?p=2509

const ECPAY_URL = 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5';
const ECPAY_URL_TEST = 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5';

function generateCheckMacValue(params: Record<string, string>, hashKey: string, hashIv: string): string {
  const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  const raw = `HashKey=${hashKey}&${sorted}&HashIV=${hashIv}`;
  const encoded = encodeURIComponent(raw)
    .toLowerCase()
    .replace(/%20/g, '+')
    .replace(/%21/g, '!')
    .replace(/%28/g, '(')
    .replace(/%29/g, ')')
    .replace(/%2a/g, '*');
  return crypto.createHash('sha256').update(encoded).digest('hex').toUpperCase();
}

export async function POST(req: NextRequest) {
  try {
    const { items, customer, totalAmount } = await req.json();

    const merchantId = process.env.ECPAY_MERCHANT_ID!;
    const hashKey = process.env.ECPAY_HASH_KEY!;
    const hashIv = process.env.ECPAY_HASH_IV!;
    const returnUrl = process.env.ECPAY_RETURN_URL!;
    const orderResultUrl = process.env.ECPAY_ORDER_RESULT_URL!;

    const merchantTradeNo = `YJ${Date.now()}`.substring(0, 20);
    const tradeDesc = '一吉水果乾批發訂購';
    const itemNames = items.map((i: { product: { name: string }; quantity: number }) =>
      `${i.product.name}x${i.quantity}`
    ).join('#');

    const params: Record<string, string> = {
      MerchantID: merchantId,
      MerchantTradeNo: merchantTradeNo,
      MerchantTradeDate: new Date().toLocaleString('zh-TW', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).replace(/\//g, '/'),
      PaymentType: 'aio',
      TotalAmount: String(Math.round(totalAmount)),
      TradeDesc: encodeURIComponent(tradeDesc),
      ItemName: itemNames.substring(0, 400),
      ReturnURL: returnUrl,
      OrderResultURL: orderResultUrl,
      ChoosePayment: 'ALL',
      EncryptType: '1',
    };

    params.CheckMacValue = generateCheckMacValue(params, hashKey, hashIv);

    // 產生自動提交表單的 HTML
    const formHtml = `
      <form id="payForm" method="POST" action="${process.env.NODE_ENV === 'production' ? ECPAY_URL : ECPAY_URL_TEST}">
        ${Object.entries(params).map(([k, v]) => `<input type="hidden" name="${k}" value="${v}">`).join('')}
      </form>
      <script>document.getElementById('payForm').submit();</script>
    `;

    // 回傳 data URL（讓前端導向此頁）
    const paymentUrl = `data:text/html;charset=utf-8,${encodeURIComponent(formHtml)}`;

    return NextResponse.json({ paymentUrl, merchantTradeNo });
  } catch (error) {
    console.error('ECPay error:', error);
    return NextResponse.json({ error: '付款建立失敗' }, { status: 500 });
  }
}
