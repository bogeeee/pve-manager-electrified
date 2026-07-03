Ext.define('PVE.sdn.Fabric.OpenFabric.Node.Edit', {
    extend: 'PVE.sdn.Fabric.Node.Edit',
    protocol: 'openfabric',
    onlineHelp: 'pvesdn_openfabric_node',

    extraRequestParams: {
        protocol: 'openfabric',
    },
});
