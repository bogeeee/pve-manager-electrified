Ext.define('Pve.sdn.Fabric', {
    extend: 'Ext.data.Model',
    idProperty: 'name',
    fields: ['id', 'protocol', 'ip_prefix', 'ip6_prefix'],
});

Ext.define('Pve.sdn.Node', {
    extend: 'Ext.data.Model',
    idProperty: 'name',
    fields: ['fabric_id', 'node_id', 'protocol', 'ip', 'ip6', 'area'],
});

Ext.define('Pve.sdn.Interface', {
    extend: 'Ext.data.Model',
    idProperty: 'name',
    fields: ['name', 'ip', 'ip6', 'hello_interval', 'hello_multiplier', 'csnp_interval'],
});
