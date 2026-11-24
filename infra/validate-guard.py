"""Project constraints, evaluated using pinned official AWS Guard release."""
from pathlib import Path
import json
import hashlib
import subprocess
import tarfile
import urllib.request

rules = '''
let buckets = Resources.*[ Type == "AWS::S3::Bucket" ]
rule private_buckets when %buckets !empty {
  %buckets.Properties.PublicAccessBlockConfiguration {
    BlockPublicAcls == true
    BlockPublicPolicy == true
    IgnorePublicAcls == true
    RestrictPublicBuckets == true
  }
  %buckets.Properties.BucketEncryption exists
  %buckets.DeletionPolicy == "Retain"
}
rule no_nat_or_database_ownership {
  Resources.*.Type != "AWS::EC2::NatGateway"
  Resources.*.Type != "AWS::RDS::DBInstance"
  Resources.*.Type != "AWS::RDS::DBCluster"
}
let functions = Resources.*[ Type == "AWS::Lambda::Function" ]
rule verified_database_tls when %functions !empty {
  %functions.Properties.Environment.Variables.DATABASE_SSL == "verify-full"
  %functions.Properties.VpcConfig exists
}
'''
directory = Path('.deploy/guard')
directory.mkdir(parents=True, exist_ok=True)
release = json.load(urllib.request.urlopen('https://api.github.com/repos/aws-cloudformation/cloudformation-guard/releases/tags/3.3.0'))
asset = next(a for a in release['assets'] if a['name'] == 'cfn-guard-v3-x86_64-ubuntu-latest.tar.gz')
body = urllib.request.urlopen(asset['browser_download_url']).read()
assert asset.get('digest') == 'sha256:' + hashlib.sha256(body).hexdigest(), 'Official release digest missing or mismatched'
archive = directory / 'guard.tar.gz'
archive.write_bytes(body)
with tarfile.open(archive) as tar:
    tar.extractall(directory, filter='data')
executable = next(directory.rglob('cfn-guard'))
rulefile = directory / 'project.guard'
rulefile.write_text(rules)
for name in ['foundation', 'app']:
    subprocess.run([str(executable), 'validate', '--data', f'infra/{name}.json', '--rules', str(rulefile), '--output-format', 'json'], check=True)
