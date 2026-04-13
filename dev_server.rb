require 'webrick'
require 'json'

root = File.expand_path(__dir__)

server = WEBrick::HTTPServer.new(
  Port: 9000,
  BindAddress: '127.0.0.1',
  DocumentRoot: root,
  AccessLog: [],
  Logger: WEBrick::Log.new($stderr, WEBrick::Log::WARN)
)

server.mount_proc('/') do |req, res|
  # 动态拦截 manifest.json 请求，直接读取目录文件并返回
  if req.path.end_with?('/src/presets/manifest.json')
    presets_dir = File.join(root, 'src', 'presets')
    files = []
    if Dir.exist?(presets_dir)
      files = Dir.entries(presets_dir).select { |f| f.end_with?('.json') && f != 'manifest.json' }
    end
    res.status = 200
    res['Content-Type'] = 'application/json'
    res.body = files.to_json
    next
  end

  path = File.expand_path(File.join(root, req.path))
  path = File.join(path, 'index.html') if File.directory?(path)

  unless path.start_with?(root) && File.file?(path)
    res.status = 404
    res.body = 'Not Found'
    next
  end

  res['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
  res['Pragma'] = 'no-cache'
  res['Expires'] = '0'
  res.body = File.binread(path)
  res.content_type = WEBrick::HTTPUtils.mime_type(path, WEBrick::HTTPUtils::DefaultMimeTypes)
end

trap('INT') { server.shutdown }
trap('TERM') { server.shutdown }

server.start
