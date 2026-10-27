fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'chipeo_audio'
description 'Sistema de audio de vehiculo con biblioteca musical, ecualizador y amplificadores (NUI)'
version '1.0.0'

shared_script 'config.lua'
client_script 'client.lua'
server_script 'server.lua'

ui_page 'html/index.html'

files {
    'html/index.html',
    'html/style.css',
    'html/script.js'
}
