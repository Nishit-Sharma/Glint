export const conceptSource='Sunlight heats surface water. Surface water evaporates into water vapor. These notes do not provide an evaporation rate.';
const c=(quote:string)=>[{source:'S1',quote}];
export const conceptProposal=()=>({schemaVersion:1,kind:'concept-map',title:'Evaporation in these notes',summary:'The notes connect sunlight, surface water and water vapor. The evaporation rate remains unknown.',nodes:[
 {id:'sunlight',title:'Sunlight',detail:'Sunlight heats surface water.',basis:'quotation',reason:'',citations:c('Sunlight heats surface water.')},
 {id:'water',title:'Surface water',detail:'Surface water evaporates into water vapor.',basis:'quotation',reason:'',citations:c('Surface water evaporates into water vapor.')},
 {id:'vapor',title:'Water vapor',detail:'The notes name water vapor as the result of evaporation.',basis:'interpretation',reason:'This paraphrases the stated evaporation sentence; it adds no rate or environmental conditions.',citations:c('Surface water evaporates into water vapor.')},
 {id:'rate',title:'Evaporation rate',detail:'The evaporation rate is not supplied.',basis:'unknown',reason:'The notes explicitly omit the rate, so a numeric rate cannot be inferred.',citations:c('These notes do not provide an evaporation rate.')}
],relationships:[
 {id:'heating',from:'sunlight',to:'water',label:'heats',detail:'The notes describe sunlight heating surface water.',basis:'interpretation',reason:'This directed link represents the supplied heating sentence; it does not establish conditions beyond that passage.',citations:c('Sunlight heats surface water.')},
 {id:'evaporation',from:'water',to:'vapor',label:'evaporates into',detail:'Surface water is connected to water vapor by the stated evaporation process.',basis:'interpretation',reason:'The link follows the supplied sentence. The notes provide no measurement or timing.',citations:c('Surface water evaporates into water vapor.')},
 {id:'missing-rate',from:'water',to:'rate',label:'has an unspecified rate',detail:'The map cannot assign an evaporation rate to this water.',basis:'unknown',reason:'The source explicitly says no evaporation rate is provided.',citations:c('These notes do not provide an evaporation rate.')}
]});
