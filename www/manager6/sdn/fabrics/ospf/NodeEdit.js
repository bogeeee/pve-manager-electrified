Ext.define('PVE.sdn.Fabric.Ospf.Node.Edit', {
    extend: 'PVE.sdn.Fabric.Node.Edit',
    protocol: 'ospf',

    extraRequestParams: {
        protocol: 'ospf',
    },
});
