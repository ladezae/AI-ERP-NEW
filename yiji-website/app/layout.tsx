import type { Metadata } from 'next';
import './globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { CartProvider } from '@/components/CartContext';
import ToastContainer from '@/components/ToastContainer';

export const metadata: Metadata = {
  title: '一吉水果乾批發零售 | 天然健康・台灣品質',
  description: '嚴選台灣及世界各地優質水果乾、蔬果脆片批發零售。天然、無添加、衛生可靠。提供樣品試購、彈性詢價、快速出貨服務。',
  keywords: '水果乾批發零售, 蔬果脆片, 台灣水果乾, 健康零食批發, 一吉水果乾',
  openGraph: {
    title: '一吉水果乾批發',
    description: '天然健康的水果乾與蔬果脆片批發商',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body className="bg-cream min-h-screen flex flex-col">
        <CartProvider>
          <Header />
          <main className="flex-1">
            {children}
          </main>
          <Footer />
          <ToastContainer />
        </CartProvider>
      </body>
    </html>
  );
}
