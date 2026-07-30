// Native-federation config for the "tube" remote.
//
// The shareAll args + RxJS skip list live in ./federation-base.js (copied
// BYTE-IDENTICAL from the hugmesh.systems host, like every other HugMesh
// remote) so this remote's federation surface can't drift from the host. The
// remote name ("tube") and the exposed module key ("./Tube") are the contract
// the host's loadRemoteModule() depends on AND the contract the federation-api
// tube module row points at:
//   remote_entry_url = http://hugmesh-tube-ui:8080/remoteEntry.json
//   metadata.mountAt = /tube   metadata.requiresRole = tube   visibility = internal
// So the remoteEntry.json emitted by the production build MUST expose ./Tube,
// and the container MUST serve it on :8080 (see Dockerfile + nginx.conf).
const { hugmeshRemote } = require('./federation-base');

module.exports = hugmeshRemote({
  name: 'tube',
  exposes: {
    './Tube': './src/app/tube.routes.ts',
  },
});
