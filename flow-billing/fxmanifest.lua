fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'flow-billing'
author 'FlowDev'
description 'Facturas / multas para trabajos (policia, EMS, mecanico...) con NUI'
version '1.0.0'

shared_script 'config.lua'
client_script 'client.lua'
server_scripts {
    'server/framework.lua',
    'server/storage.lua',
    'server/main.lua'
}

ui_page 'html/index.html'

files {
    'html/index.html',
    'html/style.css',
    'html/script.js',
    'html/fonts/*.woff2'
}
