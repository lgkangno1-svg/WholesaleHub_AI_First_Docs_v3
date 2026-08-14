import ExcelJS from "exceljs";

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile('/home/tnfwod/projects/wholesalehub/reports/rebuild/dailyfood-product-export.xlsx');
const sheet = wb.worksheets[0];

sheet.eachRow((r, n) => {
  const row = r.values;
  const str = JSON.stringify(row);
  if (str.includes('전복') || str.includes('문어')) {
    console.log(`Row ${n}:`, row[2], row[3], row[4], row[5], row[6], row[7]);
  }
});
