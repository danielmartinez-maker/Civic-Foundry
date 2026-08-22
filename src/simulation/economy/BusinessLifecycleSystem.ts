import { LIFECYCLE } from '../../data/economy.ts';
import type { Firm, FirmStatus } from './FirmSystem.ts';

export type FirmCycleFinancials=Readonly<{revenue:number;inputCost:number;wageCost:number;utilityCost:number;taxCost:number;logisticsCost:number;shortagePenalty:number;operatingMargin:number}>;
export type FirmLifecycleUpdate=Readonly<{status:FirmStatus;cashHealth:number;consecutiveLossCycles:number;consecutiveRecoveryCycles:number;lastOperatingMargin:number;closureTick?:number;distressReason?:string}>;
export type FormationContext=Readonly<{reachableGateway:boolean;utilityRatio:number;laborAvailability:number;accessibility:number;localDemand:number;sectorGap:number;taxRate:number}>;

export class BusinessLifecycleSystem{
  evaluateFirm(firm:Firm,financials:FirmCycleFinancials,tick:number):FirmLifecycleUpdate{
    const margin=Number.isFinite(financials.operatingMargin)?financials.operatingMargin:0;
    const cashHealth=Math.max(0,Math.min(1,firm.cashHealth+margin*LIFECYCLE.healthMarginScale));
    const losing=margin<0;
    const consecutiveLossCycles=losing?firm.consecutiveLossCycles+1:0;
    const recovering=!losing&&cashHealth>=LIFECYCLE.recoverHealth?firm.consecutiveRecoveryCycles+1:0;
    let status:FirmStatus=firm.status;
    let closureTick: number | undefined=firm.closureTick;
    let distressReason: string | undefined=firm.distressReason;
    if(firm.status==='forming') status='forming';
    else if(consecutiveLossCycles>=LIFECYCLE.lossCyclesToClose&&cashHealth<=LIFECYCLE.closeHealth){status='closed';closureTick=tick;distressReason='sustained negative operating health';}
    else if(firm.status==='distressed'&&recovering>=LIFECYCLE.recoveryCyclesToOperate){status='operating';distressReason=undefined;}
    else if(cashHealth<=LIFECYCLE.distressHealth||consecutiveLossCycles>=2){status='distressed';distressReason=this.primaryConstraint(financials);}
    const result:any={status,cashHealth,consecutiveLossCycles,consecutiveRecoveryCycles:recovering,lastOperatingMargin:margin};
    if(closureTick!==undefined)result.closureTick=closureTick;if(distressReason!==undefined)result.distressReason=distressReason;
    return result;
  }
  scoreFormation(context:FormationContext):number{
    if(!context.reachableGateway)return 0;
    const utility=Math.max(0,Math.min(1,context.utilityRatio));const labor=Math.max(0,Math.min(1,context.laborAvailability));const access=Math.max(0,Math.min(1,context.accessibility));const demand=Math.max(0,Math.min(1,context.localDemand));const gap=Math.max(0,Math.min(1,context.sectorGap));const taxPenalty=Math.max(0,Math.min(1,context.taxRate/0.25));
    return Math.max(0,Math.min(1,0.25*utility+0.2*labor+0.2*access+0.2*demand+0.15*gap-0.15*taxPenalty));
  }
  private primaryConstraint(f:FirmCycleFinancials):string{const costs:[string,number][]=[['input cost',f.inputCost],['wage cost',f.wageCost],['utility cost',f.utilityCost],['tax burden',f.taxCost],['logistics cost',f.logisticsCost],['shortage penalty',f.shortagePenalty]];costs.sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));return costs[0]?.[0]??'weak operating margin';}
}
