Ext.define('PVE.sdn.Fabric.Bgp.InterfacePanel', {
    extend: 'PVE.sdn.Fabric.InterfacePanel',

    hasIpv6Support: false,

    // BGP unnumbered interfaces have no IP - override commonColumns to
    // exclude the IP column that the base class defines.
    initComponent: function () {
        let me = this;

        me.commonColumns = me.commonColumns.filter((col) => col.dataIndex !== 'ip');

        me.callParent();
    },
});
