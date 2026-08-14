import ExcelJS from 'exceljs';

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile('/home/tnfwod/projects/wholesalehub/reports/rebuild/dailyfood-product-export.xlsx');
const sheet = wb.worksheets[0];
let count = 0;
sheet.eachRow((r, n) => {
  const s = JSON.stringify(r.values);
  if (s.includes('전복') || s.includes('문어')) {
    console.log(n, s.substring(0, 150));
    count++;
  }
});
console.log('Total found in Excel:', count);
