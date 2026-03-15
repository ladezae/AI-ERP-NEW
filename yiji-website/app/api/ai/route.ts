import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `你是「一吉水果乾批發」的專業 AI 客服助手。

公司簡介：
- 一吉水果乾批發專門提供天然水果乾、蔬果脆片、沖泡類果乾等商品
- 商品以台灣在地及進口優質原料製作，強調天然、衛生、可靠
- 主要服務批發採購客戶，提供樣品試購及正式訂購服務

你可以回答的問題類型：
1. 商品成分：解釋天然水果乾的成分，有無添加糖、防腐劑、色素等
2. 保存方式：溫度、濕度、包裝、開封後的保存建議
3. 詢價建議：說明批發價格結構，建議訂購量，如何計算採購成本
4. 推薦搭配：水果乾在烘焙、飲料、料理中的搭配建議
5. 採購流程：樣品流程、正式訂購流程、出貨時間

回答原則：
- 使用繁體中文
- 語氣親切專業，像一個懂行的批發業務
- 如果是價格細節問題，說明可以直接在商品頁查看，或聯絡業務洽談
- 不要捏造不確定的資訊，若不確定可以建議聯絡業務
- 回答簡潔，適當分段，不超過 300 字`;

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: messages.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const reply = response.content[0].type === 'text' ? response.content[0].text : '抱歉，無法取得回應。';

    return NextResponse.json({ reply });
  } catch (error) {
    console.error('AI API error:', error);
    return NextResponse.json({ reply: '目前 AI 服務暫時無法使用，請直接聯絡我們的業務人員。' }, { status: 500 });
  }
}
