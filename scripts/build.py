#!/usr/bin/env python3
"""Assemble the single-page app HTML from src/ (template markers) and vendored fonts. Used by the web trial build and tests."""
from pathlib import Path
import base64
import re

ROOT = Path(__file__).resolve().parent.parent

def font_faces_css():
    # vendor/fonts/fonts.css with every url('file') replaced by a base64 data URI (see vendor/fonts/README.md).
    fonts = ROOT / 'vendor/fonts'
    def inline(match):
        data = (fonts / match.group(1)).read_bytes()
        return "url('data:font/woff2;base64," + base64.b64encode(data).decode('ascii') + "')"
    css, count = re.subn(r"url\('([^']+\.woff2)'\)", inline, (fonts / 'fonts.css').read_text())
    if not count:
        raise RuntimeError('vendor/fonts/fonts.css declares no fonts')
    return css

def assemble_html():
    html = (ROOT / 'src/template.html').read_text()
    for marker, filename, tag in [('<!--UI_TOKENS-->','ui-tokens.css','style'),('<!--PREVIEW_STYLE-->','styles.css','style'),('<!--CUSTOMER_SETTINGS_MODEL-->','customer-settings-model.js','script'),('<!--RATE_MODEL-->','rate-model.js','script'),('<!--PREVIEW_MODEL-->','model.js','script'),('<!--PREVIEW_SEGMENTS-->','segments.js','script'),('<!--LAI_MODULES-->','modules.js','script'),('<!--CUSTOMER_TOOLS-->','customer-tools.js','script'),('<!--ORDER_FIELDS_MODEL-->','order-fields-model.js','script'),('<!--LAI_BUSINESS_MODEL-->','business-model.js','script'),('<!--TEAM_MODEL-->','team-model.js','script'),('<!--TEAM_UI-->','team-ui.js','script'),('<!--OPP_MODEL-->','opportunity-model.js','script'),('<!--OPP_UI-->','opportunity-ui.js','script'),('<!--PRODUCT_MODEL-->','product-model.js','script'),('<!--PRODUCT_UI-->','product-ui.js','script'),('<!--DOC_TEMPLATE_MODEL-->','doc-template-model.js','script'),('<!--DOC_TEMPLATE_UI-->','doc-template-ui.js','script'),('<!--ROLE_MODEL-->','role-model.js','script'),('<!--ROLE_FIELDS-->','role-fields.js','script'),('<!--ROLE_UI-->','role-ui.js','script'),('<!--WORKBENCH-->','workbench.js','script'),('<!--SETTINGS_HUB-->','settings-hub.js','script'),('<!--ORDERS_PAGE-->','orders-page.js','script'),('<!--ORDER_FIELDS_UI-->','order-fields-ui.js','script'),('<!--LAI_BUSINESS_UI-->','business-ui.js','script'),('<!--RATE_UI-->','rate-ui.js','script'),('<!--FEATURE_SWITCH_STYLE-->','feature-switch.css','style'),('<!--FEATURE_SWITCH_MODEL-->','feature-switch-model.js','script'),('<!--FEATURE_SWITCH_UI-->','feature-switch-ui.js','script'),('<!--CUSTOMER_REPLICA_STYLE-->','customer-replica.css','style'),('<!--CUSTOMER_DETAIL_STYLE-->','customer-detail.css','style'),('<!--CUSTOMER_EDITOR_STYLE-->','customer-editor.css','style'),('<!--BUSINESS_STYLE-->','business.css','style'),('<!--EXPORT_STYLE-->','export.css','style'),('<!--MAIL_STYLE-->','mail.css','style'),('<!--WHATSAPP_STYLE-->','whatsapp.css','style'),('<!--RATE_STYLE-->','rate.css','style'),('<!--SKIN_GLASS-->','skin-glass.css','style'),('<!--UI_KIT_STYLE-->','ui-kit.css','style'),('<!--LAI_MAIL_EDITOR-->','mail-editor.js','script'),('<!--LAI_MAIL_UI-->','mail-ui.js','script'),('<!--WHATSAPP_MODEL-->','whatsapp-model.js','script'),('<!--WHATSAPP_UI-->','whatsapp-ui.js','script'),('<!--CUSTOMER_FIELDS-->','customer-fields.js','script'),('<!--EXPORT_MODEL-->','export-model.js','script'),('<!--EXPORT_UI-->','export-ui.js','script'),('<!--FIELD_MODEL-->','field-model.js','script'),('<!--CUSTOMER_LIST-->','customer-list-ui.js','script'),('<!--CUSTOMER_DETAIL-->','customer-detail-ui.js','script'),('<!--CUSTOMER_EDITOR-->','customer-editor-ui.js','script'),('<!--CUSTOMER_COUNTRY-->','customer-country.js','script'),('<!--CUSTOMER_SELECT_STYLE-->','customer-select.css','style'),('<!--CUSTOMER_SUGGESTIONS_STYLE-->','customer-suggestions.css','style'),('<!--CUSTOMER_SETTINGS_STYLE-->','customer-settings.css','style'),('<!--DATE_PICKER_STYLE-->','../vendor/flatpickr/flatpickr.min.css|../vendor/flatpickr/monthSelect.css|date-picker.css','style'),('<!--CUSTOMER_SELECT-->','customer-select.js','script'),('<!--CUSTOMER_SUGGESTIONS-->','customer-suggestions.js','script'),('<!--DATE_PICKER-->','../vendor/flatpickr/flatpickr.min.js|../vendor/flatpickr/l10n-zh.js|../vendor/flatpickr/monthSelect.js|date-picker.js','script'),('<!--CUSTOMER_SETTINGS_UI-->','customer-settings-ui.js','script'),('<!--CUSTOMER_IMPORT-->','customer-import.js','script'),('<!--CHANGELOG-->','changelog.js','script'),('<!--RAIL_MENU-->','rail-menu.js','script'),('<!--NAV_FAVORITES-->','nav-favorites.js','script'),('<!--ACTIVITY_CATEGORY_NAVIGATION-->','activity-category-navigation.js','script'),('<!--CUSTOMER_MOTION-->','customer-motion.js','script'),('<!--UI_TRUNCATION-->','truncation-title.js','script'),('<!--PREVIEW_APP-->','app.js','script')]:
        if html.count(marker) != 1:
            raise RuntimeError('Missing or duplicate template marker: ' + marker)
        html = html.replace(marker, '<' + tag + '>\n' + '\n'.join((ROOT / 'src' / part).read_text() for part in filename.split('|')) + '\n</' + tag + '>', 1)
    if html.count('<!--UI_FONTS-->') != 1:
        raise RuntimeError('Missing or duplicate template marker: <!--UI_FONTS-->')
    html = html.replace('<!--UI_FONTS-->', '<style>\n' + font_faces_css() + '</style>', 1)
    return html
