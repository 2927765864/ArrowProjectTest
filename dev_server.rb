require 'webrick'

root = File.expand_path(__dir__)

server = WEBrick::HTTPServer.new(
  Port: 9000,
  BindAddress: '127.0.0.1',
  DocumentRoot: root,
  AccessLog: [],
  Logger: WEBrick::Log.new($stderr, WEBrick::Log::WARN)
)

server.mount_proc('/') do |req, res|
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
