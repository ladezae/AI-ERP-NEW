
import { Injectable, inject } from '@angular/core';
import { CompanyProfile, ExportTemplate, TemplateSection } from '../models/erp.models';
import { DataService } from './data.service';

@Injectable({
  providedIn: 'root'
})
export class PrintService {
  private dataService = inject(DataService);

  constructor() { }

  /**
   * Generates the HTML string for the order printout (Sales Order).
   */
  generateOrderHtml(group: any, company: CompanyProfile | undefined, templateId?: string): string | null {
    // 1. Get Template
    const templates = this.dataService.exportTemplates();
    
    // Try to find specific template, otherwise default to first 'order' type, otherwise first available
    let template: ExportTemplate | undefined;
    
    if (templateId) {
        template = templates.find(t => t.id === templateId);
    }
    
    if (!template) {
        template = templates.find(t => t.type === 'order') || templates[0];
    }

    if (!template) {
        alert('找不到訂單列印版型，請先至系統設定新增版型。');
        return null;
    }

    // 2. Prepare Data
    const itemsRaw = group.items || [];
    
    // Robust Item Mapping with Fallback Calculation
    const items = itemsRaw.map((i: any, idx: number) => {
        const qty = Number(i.quantity) || 0;
        // Fallback: If priceBeforeTax is missing/0, try to find product price
        let price = Number(i.priceBeforeTax);
        if (!price && i.productId) {
            const prod = this.dataService.products().find(p => p.id === i.productId);
            if (prod) price = prod.priceBeforeTax;
        }
        price = price || 0;

        const subtotal = i.subtotal || (price * qty);

        return {
            index: idx + 1,
            id: i.productId,
            name: i.productName,
            unit: i.unit || '個',
            qty: qty,
            price: price,
            total: subtotal,
            note: i.productNote || ''
        };
    });

    const subtotal = items.reduce((sum: number, item: any) => sum + item.total, 0);
    const isTaxable = itemsRaw.length > 0 ? itemsRaw[0].orderTaxType : true;
    const taxRate = isTaxable ? 0.05 : 0;
    const tax = Math.round(subtotal * taxRate);
    const totalAmount = subtotal + tax;
    
    const codAmount = group.items[0]?.codAmount || 0;

    const customers = this.dataService.customers();
    const customerDef = customers.find(c => c.id === group.customerId);

    const contactName = group.items[0]?.receiverName || customerDef?.receiver1 || customerDef?.shortName || group.customerName;
    const contactPhone = group.items[0]?.receiverPhone || customerDef?.phone1 || customerDef?.mobile || customerDef?.phone || '';
    const contactAddress = group.items[0]?.receiverAddress || customerDef?.address1 || '';

    const data = {
        company: {
            name: company?.name || group.sellerName || '公司名稱',
            phone: company?.phone || '',
            fax: company?.fax || '',
            address: company?.address || '',
            taxId: company?.taxId || '',
            logoUrl: company?.logoUrl || '',
            brandName: group.brandName || ''
        },
        document: {
            id: group.baseOrderId,
            date: group.orderDate,
            title: template.title || '訂購單'
        },
        target: { // Customer
            name: group.customerName,
            fullName: customerDef?.fullName || group.customerName,
            id: group.customerId,
            taxId: customerDef?.taxId || '',
            contact: contactName,
            phone: contactPhone,
            address: contactAddress
        },
        items: items,
        totals: { subtotal, tax, total: totalAmount, codAmount },
        specialRequests: group.items[0]?.specialRequests || '無'
    };

    // 3. Generate HTML
    return this.buildHtml(template, data, 'order');
  }

  /**
   * Generates the HTML string for the purchase order printout.
   */
  generatePurchaseHtml(group: any, company: CompanyProfile | undefined): string | null {
    // 1. Get Template
    const templates = this.dataService.exportTemplates();
    const template = templates.find(t => t.type === 'purchase') || templates.find(t => t.type === 'order') || templates[0];

    if (!template) {
        alert('找不到採購單列印版型，請先至系統設定新增版型。');
        return null;
    }

    // 2. Prepare Data
    const itemsRaw = group.items || [];
    
    // Robust Item Mapping
    const items = itemsRaw.map((i: any, idx: number) => {
        const qty = Number(i.quantity) || 0;
        let price = Number(i.priceBeforeTax) || 0; // Usually PO doesn't have this on Order model, check Product
        
        if (!price && i.productId) {
            const prod = this.dataService.products().find(p => p.id === i.productId);
            if (prod) price = prod.costBeforeTax; // Use Cost for PO
        }
        
        const subtotal = price * qty;
        
        return {
            index: idx + 1,
            id: i.productId,
            name: i.productName || i.productId,
            unit: i.unit || '個',
            qty: qty,
            price: price,
            total: subtotal,
            note: i.purchaseNote || ''
        };
    });

    const subtotal = items.reduce((sum: number, item: any) => sum + item.total, 0);

    const isTaxable = group.supplierTaxType !== '免稅';
    const taxRate = isTaxable ? 0.05 : 0;
    const tax = Math.round(subtotal * taxRate);
    const totalAmount = subtotal + tax;

    const suppliers = this.dataService.suppliers();
    const supplierDef = suppliers.find(s => s.code === group.supplierCode);

    const data = {
        company: { // Our Company (Buyer)
            name: company?.name || this.dataService.systemSettings().companyName || '本公司',
            phone: company?.phone || '',
            fax: company?.fax || '',
            address: company?.address || '',
            taxId: company?.taxId || '',
            logoUrl: company?.logoUrl || '',
            brandName: ''
        },
        document: {
            id: group.poNumber,
            date: group.purchaseDate,
            title: template.title || '採購單'
        },
        target: { // Supplier (Seller)
            name: group.supplierName,
            fullName: supplierDef?.fullName || group.supplierName,
            id: group.supplierCode,
            taxId: supplierDef?.taxId || '',
            contact: supplierDef?.jobTitle || '',
            phone: supplierDef?.phone || '',
            address: supplierDef?.address || ''
        },
        items: items,
        totals: { subtotal, tax, total: totalAmount, codAmount: 0 },
        specialRequests: group.purchaseNote || '無'
    };

    // 3. Generate HTML
    return this.buildHtml(template, data, 'purchase');
  }

  private buildHtml(template: ExportTemplate, data: any, docType: 'order' | 'purchase'): string {
      const bodyContent = template.sections
        .filter(s => s.visible)
        .map(s => this.renderSection(s, data, template.showPrice, docType))
        .join('');

      return `
        <!DOCTYPE html>
        <html lang="zh-TW">
        <head>
          <meta charset="UTF-8">
          <title>${data.document.title} - ${data.document.id}</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <style>
            @media print {
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              @page { margin: 10mm; size: A4; }
              .no-print { display: none; }
              .page-break { page-break-before: always; }
              table { page-break-inside: auto; }
              tr { page-break-inside: avoid; page-break-after: auto; }
            }
            body { 
              font-family: "Microsoft JhengHei", "Heiti TC", sans-serif; 
              background: white; 
              color: black; 
              line-height: 1.4;
              margin: 0;
              padding: 10mm;
              width: 210mm;
              min-width: 210mm;
              margin-left: auto;
              margin-right: auto;
              box-sizing: border-box; 
            }
            .border-black { border-color: black !important; }
          </style>
        </head>
        <body>
          ${bodyContent}
          <div class="mt-8 text-center text-xs text-gray-400 no-print">
             列印時間：${new Date().toLocaleString()}
          </div>
        </body>
        </html>
      `;
  }

  private renderSection(section: TemplateSection, data: any, showPrice: boolean, docType: 'order' | 'purchase'): string {
      const isPO = docType === 'purchase';
      const lblTargetName = isPO ? '廠商名稱' : '客戶名稱';
      const lblTargetId = isPO ? '廠商編號' : '客戶編號';
      const lblTargetTax = isPO ? '廠商統編' : '抬頭統編';
      
      switch (section.type) {
          case 'company_header':
              return `
                <div class="flex justify-between items-end mb-4 border-b-2 border-black pb-2">
                    <div class="text-xs w-1/3 leading-relaxed">
                        <div>電話：${data.company.phone}</div>
                        <div>傳真：${data.company.fax}</div>
                        <div>地址：${data.company.address}</div>
                    </div>
                    <div class="w-1/3 text-center">
                        <h1 class="text-3xl font-bold tracking-widest">${section.title || data.document.title}</h1>
                    </div>
                    <div class="text-right text-xs w-1/3 flex justify-end items-center gap-3">
                        <div class="leading-tight">
                            ${data.company.brandName ? `<div class="font-bold tracking-wide mb-1">${data.company.brandName}</div>` : ''}
                            <div class="font-bold text-sm">${data.company.name}</div>
                            <div class="mt-1">統編: ${data.company.taxId}</div>
                        </div>
                        ${data.company.logoUrl ? `<img src="${data.company.logoUrl}" class="h-12 object-contain" />` : ''}
                    </div>
                </div>
              `;
          
          case 'document_title':
              return `<div class="text-center py-2"><h1 class="text-2xl font-bold">${section.title || data.document.title}</h1></div>`;
          
          case 'customer_info':
              return `
                <div class="border border-black flex text-sm mb-4">
                    <div class="w-3/5 border-r border-black p-2 space-y-1">
                        <div class="flex"><span class="font-bold w-20">${lblTargetName}：</span><span>${data.target.name} <span class="text-xs font-normal">(${data.target.id})</span></span></div>
                        <div class="flex"><span class="font-bold w-20">${lblTargetTax}：</span><span>${data.target.fullName} ${data.target.taxId ? ' ' + data.target.taxId : ''}</span></div>
                        <div class="flex"><span class="font-bold w-20">聯 絡 人：</span><span>${data.target.contact}</span></div>
                        <div class="flex"><span class="font-bold w-20">電　　話：</span><span>${data.target.phone}</span></div>
                        <div class="flex"><span class="font-bold w-20">地　　址：</span><span>${data.target.address}</span></div>
                    </div>
                    <div class="w-2/5 p-2 flex flex-col justify-center space-y-1">
                        <div class="flex"><span class="font-bold w-24 text-right">單據日期：</span><span class="pl-2">${data.document.date}</span></div>
                        <div class="flex"><span class="font-bold w-24 text-right">單據編號：</span><span class="pl-2">${data.document.id}</span></div>
                    </div>
                </div>
              `;

          case 'items_table':
              let visibleCols = ['id', 'name', 'unit', 'qty', 'price', 'total', 'note'];
              try { if(section.content) visibleCols = JSON.parse(section.content); } catch {}
              
              const th = (key: string, label: string, align: string, w: string) => 
                  visibleCols.includes(key) && (showPrice || (key !== 'price' && key !== 'total')) 
                  ? `<th class="p-1 border-r border-black ${align} ${w} bg-gray-50">${label}</th>` : '';

              const td = (key: string, val: any, align: string) => 
                  visibleCols.includes(key) && (showPrice || (key !== 'price' && key !== 'total')) 
                  ? `<td class="p-1 border-r border-black ${align} ${key==='name'?'whitespace-normal break-words':''}">${val}</td>` : '';

              // Items
              const rows = data.items.map((i: any) => `
                  <tr class="h-6 border-b border-black last:border-0 align-top">
                      ${td('id', i.id, 'text-left')}
                      ${td('name', i.name, 'text-left')}
                      ${td('unit', i.unit, 'text-center')}
                      ${td('qty', i.qty, 'text-right font-bold')}
                      ${td('price', i.price.toLocaleString(), 'text-right')}
                      ${td('total', i.total.toLocaleString(), 'text-right')}
                      ${td('note', i.note, 'text-left text-xs')}
                  </tr>
              `).join('');

              // Filler
              const minRows = 5;
              const emptyRows = Math.max(0, minRows - data.items.length);
              const filler = Array(emptyRows).fill(0).map(() => 
                  `<tr class="h-6 last:border-0 border-b border-black">
                      ${visibleCols.map(k => (showPrice || (k!=='price' && k!=='total')) ? `<td class="p-1 border-r border-black"></td>` : '').join('')}
                   </tr>`
              ).join('');

              // Totals
              let footerRows = '';
              if (showPrice && visibleCols.includes('total')) {
                  const span = visibleCols.filter(k => k !== 'total' && k !== 'note' && (showPrice || (k !== 'price'))).length;
                  footerRows = `
                      <tr class="text-sm border-t border-black">
                          <td colspan="${span}" class="p-1 px-2 text-right font-bold border-r border-black bg-gray-50">合計</td>
                          <td class="p-1 px-2 text-right border-r border-black font-mono font-bold">${data.totals.subtotal.toLocaleString()}</td>
                          ${visibleCols.includes('note') ? '<td></td>' : ''}
                      </tr>
                      <tr class="text-sm border-t border-black">
                          <td colspan="${span}" class="p-1 px-2 text-right font-bold border-r border-black bg-gray-50">稅額</td>
                          <td class="p-1 px-2 text-right border-r border-black font-mono font-bold">${data.totals.tax.toLocaleString()}</td>
                          ${visibleCols.includes('note') ? '<td></td>' : ''}
                      </tr>
                      <tr class="text-base text-black border-t border-black">
                          <td colspan="${span}" class="p-1 px-2 text-right font-bold border-r border-black bg-gray-100">總計</td>
                          <td class="p-1 px-2 text-right border-r border-black font-bold font-mono text-2xl text-blue-900">${data.totals.total.toLocaleString()}</td>
                          ${visibleCols.includes('note') ? '<td></td>' : ''}
                      </tr>
                  `;
              }

              // Note Footer
              const noteFooter = `
                  <tr class="border-t border-black">
                      <td colspan="10" class="p-2 align-top text-black">
                          <div class="flex text-xs">
                              <span class="font-bold underline whitespace-nowrap mr-2">單據備註：</span>
                              <span class="text-black whitespace-pre-wrap font-normal flex-1">${data.specialRequests}</span>
                          </div>
                      </td>
                  </tr>
              `;

              return `
                <div class="border border-black mb-4">
                    <table class="w-full text-xs table-fixed border-collapse">
                        <thead>
                            <tr class="border-b border-black font-bold h-6">
                                ${th('id', '品號', 'text-left', 'w-[10%]')}
                                ${th('name', '品名', 'text-left', 'w-[30%]')}
                                ${th('unit', '單位', 'text-center', 'w-[6%]')}
                                ${th('qty', '數量', 'text-right', 'w-[8%]')}
                                ${th('price', '單價', 'text-right', 'w-[13%]')}
                                ${th('total', '金額', 'text-right', 'w-[15%]')}
                                ${th('note', '備註', 'text-left', 'w-[18%]')}
                            </tr>
                        </thead>
                        <tbody>
                            ${rows}
                            ${filler}
                            ${footerRows}
                            ${noteFooter}
                        </tbody>
                    </table>
                </div>
              `;

          case 'cod_amount':
              if (!data.totals.codAmount || data.totals.codAmount <= 0) return '';
              return `
                <div class="border-2 border-black p-2 mt-4 text-center font-bold text-lg text-red-600">
                    代收金額 (COD)：$ ${data.totals.codAmount.toLocaleString()}
                </div>
              `;

          case 'custom_text':
              return `
                <div class="mb-4 border border-black p-3 rounded text-sm">
                    ${section.title ? `<div class="font-bold border-b border-black pb-1 mb-2">${section.title}</div>` : ''}
                    <div class="whitespace-pre-wrap">${section.content || ''}</div>
                </div>
              `;

          case 'signatures':
              const labels = isPO 
                  ? ['【&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;】經辦', '【&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;】覆核', '【&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;】核准', '廠商簽回:'] 
                  : ['【&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;】藍單', '【&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;】綠單', '應附發票:', '審核出貨:'];
              
              return `
                <div class="mt-8 border-t-2 border-black pt-4 grid grid-cols-4 gap-4 text-sm font-medium items-center page-break-inside-avoid">
                    <div>${labels[0]}</div>
                    <div>${labels[1]}</div>
                    <div>${labels[2]}</div>
                    <div>${labels[3]}</div>
                </div>
              `;

          case 'gap':
              return `<div style="height: ${section.height || 10}mm;"></div>`;

          default: return '';
      }
  }
}
