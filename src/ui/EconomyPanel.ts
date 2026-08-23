import type { EconomyDomainSnapshot } from '../simulation/economy/EconomyScheduler.ts';

const pct=(value:number)=>`${Math.round(Math.max(0,Math.min(1,value))*100)}%`;
const number=(value:number)=>Number.isFinite(value)?value.toFixed(value>=100?0:1):'0';

export class EconomyPanel {
  render(snapshot:EconomyDomainSnapshot):string{
    const rows:[string,string][]=[
      ['Active firms',`${snapshot.activeFirms} · ${snapshot.distressedFirms} distressed · ${snapshot.formingFirms} forming`],
      ['Employment',`${snapshot.employment.employed}/${snapshot.employment.totalJobs} jobs · ${pct(snapshot.employment.unemploymentRate)} unemployment`],
      ['Industrial output',number(snapshot.industrialOutput)],['Wholesale throughput',number(snapshot.wholesaleThroughput)],['Retail sales',`$${number(snapshot.retailSales)}`],
      ['Input shortage',pct(snapshot.shortageRate)],['Freight in transit',number(snapshot.freightVolumeInTransit)],['Freight delay',`${number(snapshot.averageFreightDelay)} ticks`],['Logistics cost',number(snapshot.averageLogisticsCost)],
      ['Queued orders',`${snapshot.queuedOrders} · ${number(snapshot.queueDelay)} ticks`],['Imports',`${number(snapshot.cumulativeImports)} · $${number(snapshot.cumulativeImportValue)}`],['Exports',`${number(snapshot.cumulativeExports)} · $${number(snapshot.cumulativeExportValue)}`],
      ['Firm health',pct(snapshot.aggregateFirmHealth)],['Formation / closure',`${snapshot.businessFormations} / ${snapshot.businessClosures}`],
    ];
    return `<div class="economy-grid">${rows.map(([label,value])=>`<div class="economy-row"><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>`;
  }
}
