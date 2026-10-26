"""Functional browser checks for persisted card order and rejected styling."""
import json
import tempfile
import threading
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright
from browser_smoke import PagesHandler, ROOT


def wait_order(page, expected):
    page.wait_for_function('ids => JSON.parse(localStorage.getItem("qiuzhao:records:v1")).jobs.map(job=>job.id).join()===ids.join()', arg=expected)
    assert page.locator('#jobs>.job').evaluate_all('(cards)=>cards.map(card=>card.dataset.jobId)') == expected


def seed(page):
    page.wait_for_function('() => document.querySelector("#status").options.length===9')
    page.evaluate('''async () => {
      for(const [id,title,status] of [['a','视觉设计师','已投递'],['b','产品经理','已拒绝'],['c','视觉策划','已投递']]){
        await Tracker.api('/api/save',{id,title,status,company:'测试公司',url:'https://example.com/'+id,requirements:'品牌设计与 Figma',applied_at:'2026-10-26'});
      }
      await Tracker.api('/api/reorder',{ids:['a','b','c']});
      await reload(true);
    }''')


def run():
    server = ThreadingHTTPServer(('127.0.0.1',0),partial(PagesHandler,directory=str(ROOT/'static')))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}/qiuzhao/'
    with tempfile.TemporaryDirectory() as directory, sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':1440,'height':1200},accept_downloads=True)
        page.set_default_timeout(10000)
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        try:
            page.goto(base);seed(page)
            rejected=page.locator('[data-job-id="b"]')
            assert rejected.get_attribute('class').split().count('is-rejected')==1
            assert float(rejected.locator('.job-head').evaluate('e=>getComputedStyle(e).opacity')) < 0.6
            rejected.locator('[data-status]').select_option('已投递')
            page.wait_for_function('() => !document.querySelector("[data-job-id=b]").classList.contains("is-rejected")')
            rejected.locator('[data-status]').select_option('已拒绝')
            page.wait_for_function('() => document.querySelector("[data-job-id=b]").classList.contains("is-rejected")')

            # Actual mouse drag, then reload from the saved browser data.
            target=page.locator('[data-job-id="c"]')
            page.locator('[data-job-id="a"] .drag-handle').drag_to(target,target_position={'x':220,'y':target.bounding_box()['height']-8})
            wait_order(page,['b','c','a'])
            page.reload();page.wait_for_function('() => document.querySelectorAll("#jobs>.job").length===3')
            wait_order(page,['b','c','a'])
            assert page.locator('[data-job-id="b"]').get_attribute('class').find('is-rejected') >= 0

            # Keyboard sorting is available on the same handle.
            page.locator('[data-job-id="a"] .drag-handle').focus()
            page.keyboard.press('ArrowUp')
            wait_order(page,['b','a','c'])
            page.keyboard.press('ArrowUp')
            wait_order(page,['a','b','c'])

            # Filtered dragging keeps the hidden card in its original slot.
            page.locator('#search').fill('视觉')
            page.locator('[data-job-id="c"] .drag-handle').drag_to(page.locator('[data-job-id="a"]'),target_position={'x':220,'y':8})
            page.wait_for_function('() => JSON.parse(localStorage.getItem("qiuzhao:records:v1")).jobs[0].id==="c"')
            assert page.locator('#jobs>.job').evaluate_all('(cards)=>cards.map(card=>card.dataset.jobId)')==['c','a']
            page.locator('#search').fill('')
            wait_order(page,['c','b','a'])
            for ids in (['a','a'],['unknown']):
                error=page.evaluate('async ids=>{try{await Tracker.api("/api/reorder",{ids});return null}catch(error){return error.message}}',ids)
                assert error
                wait_order(page,['c','b','a'])

            # Order survives backup / restore without introducing a new format.
            page.locator('#settings-open').click()
            with page.expect_download() as result:
                page.locator('#backup').click()
            backup=Path(directory)/'cards.json';result.value.save_as(str(backup))
            assert [job['id'] for job in json.loads(backup.read_text())['jobs']]==['c','b','a']
            page.evaluate('async()=>{await Tracker.api("/api/reorder",{ids:["a","b","c"]});await reload()}')
            page.on('dialog',lambda dialog:dialog.accept())
            page.locator('#restore').set_input_files(str(backup))
            page.locator('#settings-close').click()
            wait_order(page,['c','b','a'])

            # Real touch events exercise Sortable's mobile path.
            mobile=browser.new_context(viewport={'width':390,'height':1800},has_touch=True,is_mobile=True)
            touch=mobile.new_page();touch.goto(base);seed(touch)
            handle=touch.locator('[data-job-id="a"] .drag-handle').bounding_box()
            destination=touch.locator('[data-job-id="c"]').bounding_box()
            x=handle['x']+handle['width']/2;y=handle['y']+handle['height']/2
            end=destination['y']+destination['height']-8
            cdp=mobile.new_cdp_session(touch)
            cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
            for step in range(1,16):
                cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x,'y':y+(end-y)*step/15}]})
                touch.wait_for_timeout(25)
            cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
            wait_order(touch,['b','c','a'])
            assert touch.evaluate('document.documentElement.scrollWidth<=innerWidth')
            mobile.close()
            assert not errors,errors
            print('PASS: mouse/touch/keyboard drag, persisted order, filtered hidden cards, invalid input safety, backups, rejected dimming and status recovery.')
        finally:
            browser.close();server.shutdown();server.server_close()


if __name__=='__main__':
    run()
