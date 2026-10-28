fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'flow-dj'
author 'FlowDev'
description 'Cabinas de DJ con YouTube/MP3, audio 3D por distancia y panel de administracion (NUI)'
version '1.0.0'

shared_script 'config.lua'
client_script 'client.lua'
server_script 'server.lua'

ui_page 'html/index.html'

files {
    'html/index.html',
    'html/style.css',
    'html/script.js',
    'html/fonts/*.woff2',
    'html/img/*.png'
}
