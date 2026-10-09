"""Run with a Python installation containing Playwright; uses stdlib for XLSX assertions."""
import base64
import gzip
import json
import tempfile
import threading
import xml.etree.ElementTree as ET
import zipfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


class PagesHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/qiuzhao/'):
            self.path = self.path[len('/qiuzhao'):]
        super().do_GET()

    def log_message(self, *_):
        pass


def run():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(PagesHandler, directory=str(ROOT/'static')))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory() as directory, sync_playwright() as p:
        chromium = Path('/usr/bin/chromium')
        options = {'headless': True, 'args': ['--no-sandbox']}
        if chromium.exists():
            options['executable_path'] = str(chromium)
        browser = p.chromium.launch(**options)
        context = browser.new_context(viewport={'width': 1440, 'height': 1100}, accept_downloads=True)
        page = context.new_page()
        page.set_default_timeout(10000)
        errors, requests = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: requests.append(request.url))
        try:
            page.goto(f'http://127.0.0.1:{server.server_port}/qiuzhao/')
            page.wait_for_function("() => document.querySelector('#status').options.length===9")
            assert page.locator('#profile').input_value() == '', 'Public app must not prefill private materials'
            page.locator('#settings-open').click()
            page.locator('#profile').fill('人工测试材料：Figma、品牌设计、包装设计、视觉系统。')
            page.locator('#save-profile').click()
            page.wait_for_function("() => JSON.parse(localStorage.getItem('qiuzhao:records:v1')).profile.includes('人工测试')")
            page.locator('#settings-close').click()
            page.locator('#source-url').fill('https://example.com/design-job')
            page.locator('#parse').click()
            page.wait_for_function("() => document.querySelector('#toast').textContent.includes('复制岗位正文')")
            text = '品牌设计师\n岗位职责：Python 工具维护\n任职要求：Figma、品牌设计、包装设计、视觉系统、Blender\n福利待遇：英语培训'
            page.locator('#source-text').fill(text)
            page.locator('#parse').click()
            page.locator('#editor').wait_for(state='visible')
            assert page.locator('#title').input_value() == '品牌设计师'
            page.locator('#company').fill('虚构测试公司')
            page.locator('#applied_at').fill('2026-10-09')
            page.locator('#status').select_option('已投递')
            page.locator('#notes').fill('=HYPERLINK("https://example.com")')
            page.locator('#job-form button[type=submit]').click()
            page.wait_for_function("() => document.querySelector('#total').textContent==='1'")
            assert page.locator('.score').inner_text().startswith('80%')
            assert 'Python' not in page.locator('.chips').inner_text()
            assert '英语' not in page.locator('.chips').inner_text()
            page.locator('[data-detail]').click()
            assert '人工测试材料' in page.locator('#job-details-content').inner_text()
            page.locator('#job-details-close').click()
            page.locator('[data-status]').select_option('一面')
            page.wait_for_function("() => document.querySelector('#interview').textContent==='1'")
            page.reload()
            page.wait_for_function("() => document.querySelector('#total').textContent==='1'")
            assert page.locator('[data-status]').input_value() == '一面'
            with page.expect_download() as result:
                page.locator('#export-excel').click()
            excel = Path(directory)/'export.xlsx'
            result.value.save_as(str(excel))
            with zipfile.ZipFile(excel) as archive:
                sheet = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
                cells = {cell.attrib['r']: cell for cell in sheet.findall('.//m:c', NS)}
                strings = ET.fromstring(archive.read('xl/sharedStrings.xml'))
                shared = [''.join(item.itertext()) for item in strings]
                def text_at(address):
                    cell = cells[address]
                    value = cell.find('m:v', NS).text
                    return shared[int(value)] if cell.attrib.get('t') == 's' else value
                assert text_at('A2') == '品牌设计师'
                assert text_at('E2') == '2026-10-09'
                assert text_at('F2') == '80%'
                assert text_at('I2') == '一面'
                assert text_at('J2').startswith('=HYPERLINK')
                assert cells['J2'].find('m:f', NS) is None, 'Text must never become a formula'
                validation = sheet.find('.//m:dataValidation', NS)
                assert validation.attrib['sqref'] == 'I2:I10000'
            page.locator('#settings-open').click()
            with page.expect_download() as result:
                page.locator('#backup').click()
            backup = Path(directory)/'backup.json'
            result.value.save_as(str(backup))
            assert len(json.loads(backup.read_text())['jobs']) == 1
            page.locator('#settings-close').click()
            page.on('dialog', lambda dialog: dialog.accept())
            page.locator('[data-delete]').click()
            page.wait_for_function("() => document.querySelector('#total').textContent==='0'")
            page.locator('#restore').set_input_files(str(backup))
            page.wait_for_function("() => document.querySelector('#total').textContent==='1'")
            page.locator('#search').fill('不存在')
            assert page.locator('.job').count() == 0
            page.locator('#search').fill('包装')
            assert page.locator('.job').count() == 1
            page.locator('#filter').select_option('Offer')
            assert page.locator('.job').count() == 0
            page.locator('#filter').select_option('')
            page.set_viewport_size({'width':390,'height':844})
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            other = browser.new_context()
            fresh = other.new_page()
            fresh.goto(f'http://127.0.0.1:{server.server_port}/qiuzhao/')
            fresh.wait_for_function("() => document.querySelector('#status').options.length===9")
            assert fresh.locator('#profile').input_value() == ''
            assert fresh.locator('#total').inner_text() == '0'
            other.close()
            # Private first-use link fills a fresh browser, strips its fragment,
            # and preserves any profile / records already saved in a browser.
            welcome = base64.urlsafe_b64encode(gzip.compress(json.dumps({'version':1,'profile':'专属入口测试：Figma、包装设计'}, ensure_ascii=False).encode())).decode().rstrip('=')
            private_url = f'http://127.0.0.1:{server.server_port}/qiuzhao/#welcome={welcome}'
            personal = browser.new_context()
            first = personal.new_page()
            first.goto(private_url)
            first.wait_for_function("() => document.querySelector('#profile').value.includes('专属入口测试')")
            assert '#' not in first.url
            assert first.locator('#total').inner_text() == '0'
            personal.close()
            page.goto(private_url)
            page.wait_for_function("() => !location.hash")
            page.wait_for_function("() => document.querySelector('#profile').value.includes('人工测试材料')")
            assert page.locator('#total').inner_text() == '1'
            assert '#' not in page.url
            page.goto(f'http://127.0.0.1:{server.server_port}/qiuzhao/#welcome=invalid')
            page.wait_for_function("() => !location.hash")
            page.wait_for_function("() => document.querySelector('#status').options.length===9")
            assert page.locator('#profile').input_value().startswith('人工测试材料')
            assert not any('welcome=' in url for url in requests), 'Personal fragment must not be sent to server'
            assert all(urlsplit(url).hostname == '127.0.0.1' for url in requests), requests
            assert not any('/api/' in url for url in requests), requests
            assert not errors, errors
            print('PASS: Pages subpath, parsing, matching, Excel, backups, mobile layout, private first-use link, existing data preserved, invalid fragment handled, no personal fragment/API/third-party requests.')
        finally:
            browser.close()
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    run()
