// Each title owns its landing page and runtime. Root is the collection only.
export function pageRoute(url){
  if(['/', '/index.html','/home.html'].includes(url.pathname)){
    if(url.searchParams.has('map')||url.searchParams.has('load'))return {redirect:'/world-at-war/'+url.search};
    return {template:'home.html',game:null};
  }
  if(['/world-at-war','/world-at-war/','/world-at-war/index.html'].includes(url.pathname))return {template:'index.html',game:'world-at-war'};
  if(['/black-ops','/black-ops/','/black-ops/index.html'].includes(url.pathname))return {template:'bo1.html',game:'black-ops'};
  return null;
}
