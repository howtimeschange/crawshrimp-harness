"""Request OS consent through Harness; never execute application actions here."""
import json
import os
from pathlib import Path
import re
import urllib.parse
import urllib.request

from .common import write_json
from .cancellation import check, marker


def request_permission(bundle_id, purpose, run_dir, backend, send=None):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]{1,254}', bundle_id):
        raise ValueError('Invalid application bundle ID')
    if not purpose.strip() or len(purpose) > 500:
        raise ValueError('A task-specific purpose of 1-500 characters is required')
    run = Path(run_dir).resolve()
    check(marker(run))
    current = backend({'command': 'automation_permission', 'bundle_id': bundle_id, 'ask_user': False})
    if current.get('status') == 'authorized':
        return {**current, 'request_attempted': False}
    receipt = run / 'automation-permissions' / f'{bundle_id}.json'
    if receipt.exists():
        return {**json.loads(receipt.read_text()), 'replayed': True, 'current_process': current, 'auto_retry': False}
    if current.get('status') not in ('not_determined', 'denied_or_restricted'):
        return {**current, 'request_attempted': False}
    if send is None:
        url = os.environ.get('CRAWSHRIMP_AUTOMATION_URL', '')
        token = os.environ.get('CRAWSHRIMP_AUTOMATION_TOKEN', '')
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or parsed.path != '/request' or not token:
            return {**current, 'status': 'host_unavailable', 'request_attempted': False,
                    'message': 'Harness authorization bridge unavailable; use desktop settings. Do not bypass the sandbox.'}
        def send(payload):
            request = urllib.request.Request(url, data=json.dumps(payload).encode(),
                headers={'Content-Type': 'application/json', 'x-crawshrimp-automation-token': token}, method='POST')
            with urllib.request.urlopen(request, timeout=130) as response:
                return json.load(response)
    state = {'status': 'unknown', 'bundle_id': bundle_id, 'purpose': purpose, 'auto_retry': False}
    write_json(receipt, state)
    try:
        check(marker(run))
        host = send({'bundle_id': bundle_id, 'purpose': purpose})
        check(marker(run))
        local = backend({'command': 'automation_permission', 'bundle_id': bundle_id, 'ask_user': False})
        state = {**host, 'current_process': local, 'auto_retry': False}
        if host.get('status') == 'authorized' and local.get('status') != 'authorized':
            state.update(status='execution_context_restricted', canRequest=False,
                         message='Host is authorized but the task context is restricted. Use available AX; do not repeat TCC requests or change sandbox permissions.')
        write_json(receipt, state)
        return state
    except Exception:
        # Unknown receipt remains durable; neither a timeout nor cancellation resends consent.
        raise
