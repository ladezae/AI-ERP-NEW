const PROJECT_ID = 'new-angular-298fe';
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function fetchAllOrders() {
    let allDocs = [];
    let nextPageToken = null;
    do {
        let url = `${BASE_URL}/orders?pageSize=300`;
        if (nextPageToken) url += `&pageToken=${nextPageToken}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.documents) allDocs = allDocs.concat(data.documents);
        nextPageToken = data.nextPageToken || null;
    } while (nextPageToken);
    return allDocs;
}

function getFieldValue(field) {
    if (!field) return null;
    if (field.stringValue !== undefined) return field.stringValue;
    if (field.integerValue !== undefined) return Number(field.integerValue);
    if (field.doubleValue !== undefined) return Number(field.doubleValue);
    if (field.booleanValue !== undefined) return field.booleanValue;
    return null;
}

function extractBaseOrderId(orderId) {
    const parts = orderId.split('-');
    return parts.length > 3 ? parts.slice(0, 3).join('-') : orderId;
}

async function patchOrderSubtotal(docName, orderSubtotal) {
    const url = `https://firestore.googleapis.com/v1/${docName}?updateMask.fieldPaths=orderSubtotal`;
    const body = {
        fields: {
            orderSubtotal: { doubleValue: orderSubtotal }
        }
    };
    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        const err = await res.text();
        console.error(`❌ 更新失敗 ${docName}:`, err);
    }
}

async function main() {
    console.log('📦 開始讀取所有訂單...');
    const docs = await fetchAllOrders();
    console.log(`✅ 共讀取 ${docs.length} 筆訂單`);

    const groups = new Map();
    docs.forEach(doc => {
        const fields = doc.fields || {};
        const orderId = getFieldValue(fields.orderId);
        const subtotal = getFieldValue(fields.subtotal) || 0;
        if (!orderId) return;
        const baseId = extractBaseOrderId(orderId);
        if (!groups.has(baseId)) groups.set(baseId, { subtotal: 0, docs: [] });
        const group = groups.get(baseId);
        group.subtotal += subtotal;
        group.docs.push(doc);
    });

    console.log(`📊 共 ${groups.size} 張訂單群組`);

    let updated = 0;
    let skipped = 0;

    for (const [baseId, group] of groups.entries()) {
        const orderSubtotal = Math.round(group.subtotal);
        for (const doc of group.docs) {
            const existing = getFieldValue(doc.fields?.orderSubtotal);
            if (existing === orderSubtotal) { skipped++; continue; }
            await patchOrderSubtotal(doc.name, orderSubtotal);
            updated++;
            await new Promise(r => setTimeout(r, 50));
        }
        console.log(`✓ ${baseId}: orderSubtotal = ${orderSubtotal}`);
    }

    console.log(`\n🎉 完成！更新 ${updated} 筆，跳過 ${skipped} 筆`);
}

main().catch(console.error);
