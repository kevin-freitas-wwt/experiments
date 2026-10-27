#!/usr/bin/env python3
# Static server that forbids caching, so edited modules and levels reload
# without a hard refresh. Run from the folder you want served.
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCache( SimpleHTTPRequestHandler ):
    def end_headers( self ):
        self.send_header( "Cache-Control", "no-store" )
        super().end_headers()

    def log_message( self, *args ):
        pass


port = int( sys.argv[ 1 ] ) if len( sys.argv ) > 1 else 8765
print( f"http://localhost:{ port }/" )
ThreadingHTTPServer( ( "", port ), NoCache ).serve_forever()
