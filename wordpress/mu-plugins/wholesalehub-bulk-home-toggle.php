<?php
/**
 * WholesaleHub floating bulk-order panel collapse/expand control.
 * Progressive enhancement only; order links and order logic are unchanged.
 */
defined('ABSPATH') || exit;

function wholesalehub_bulk_toggle_context(): bool
{
    return function_exists('is_shop') && is_shop() && !is_paged();
}

function wholesalehub_bulk_toggle_styles(): void
{
    if (!wholesalehub_bulk_toggle_context()) return;
    echo <<<'CSS'
<style id="wholesalehub-bulk-toggle-css">
.wh-bulk-home-toggle{align-self:flex-end;appearance:none;border:1px solid #94a3b8;border-radius:999px;background:#fff;color:#1e293b;cursor:pointer;font:inherit;font-size:.85rem;font-weight:800;line-height:1.2;min-height:44px;padding:.55rem .85rem}.wh-bulk-home-toggle:hover,.wh-bulk-home-toggle:focus-visible{border-color:#4a7c40;box-shadow:0 0 0 3px rgba(74,124,64,.18);outline:0}.wh-bulk-home nav[hidden]{display:none!important}.wh-bulk-home.is-collapsed{gap:0;width:auto;max-width:calc(100vw - 48px);padding:.5rem}.wh-bulk-home.is-collapsed>div,.wh-bulk-home.is-collapsed>nav{display:none!important}.wh-bulk-home.is-collapsed .wh-bulk-home-toggle{align-self:stretch;border-color:#4a7c40;background:#4a7c40;color:#fff;min-width:168px}@media(max-width:768px){.wh-bulk-home.is-collapsed{right:12px;bottom:12px;left:auto;width:auto;max-width:calc(100vw - 24px);padding:.45rem}.wh-bulk-home.is-collapsed .wh-bulk-home-toggle{min-width:156px}}
</style>
CSS;
}
add_action('wp_head', 'wholesalehub_bulk_toggle_styles', 99);

function wholesalehub_bulk_toggle_script(): void
{
    if (!wholesalehub_bulk_toggle_context()) return;
    echo <<<'JS'
<script id="wholesalehub-bulk-toggle-js">
(function(){'use strict';var key='wholesalehub.bulkHome.expanded.v1',query='(max-width: 768px)';function read(){try{var v=window.localStorage.getItem(key);if(v==='1')return true;if(v==='0')return false}catch(e){}return null}function write(v){try{window.localStorage.setItem(key,v?'1':'0')}catch(e){}}function init(){var root=document.querySelector('.wh-bulk-home');if(!root||root.querySelector('.wh-bulk-home-toggle'))return;var nav=root.querySelector('nav');if(!nav)return;if(!nav.id)nav.id='wh-bulk-home-actions';var button=document.createElement('button');button.type='button';button.className='wh-bulk-home-toggle';button.setAttribute('aria-controls',nav.id);root.insertBefore(button,root.firstChild);var saved=read(),chosen=saved!==null,media=window.matchMedia?window.matchMedia(query):null,expanded=saved!==null?saved:!(media&&media.matches);function apply(next,persist){expanded=!!next;root.classList.toggle('is-collapsed',!expanded);nav.hidden=!expanded;button.setAttribute('aria-expanded',expanded?'true':'false');button.textContent=expanded?'접기':'빠른주문 열기';button.setAttribute('aria-label',expanded?'빠른주문 메뉴 접기':'빠른주문 메뉴 펼치기');if(persist){chosen=true;write(expanded)}}button.addEventListener('click',function(){apply(!expanded,true)});if(media){var sync=function(event){if(!chosen)apply(!event.matches,false)};if(typeof media.addEventListener==='function')media.addEventListener('change',sync);else if(typeof media.addListener==='function')media.addListener(sync)}apply(expanded,false)}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init()})();
</script>
JS;
}
add_action('wp_footer', 'wholesalehub_bulk_toggle_script', 99);
