Ext.define('pve-resource-dir-tree', {
    extend: 'Ext.data.Model',
    idProperty: 'internalId',
    fields: ['type', 'text', 'path', 'id', 'description', 'digest'],
});

Ext.define('PVE.dc.DirMapView', {
    extend: 'PVE.tree.ResourceMapTree',
    alias: 'widget.pveDcDirMapView',

    editWindowClass: 'PVE.window.DirMapEditWindow',
    baseUrl: '/cluster/mapping/dir',
    mapIconCls: 'fa fa-folder',
    entryIdProperty: 'path',

    store: {
        sorters: 'text',
        model: 'pve-resource-dir-tree',
        data: {},
    },

    columns: [
        {
            xtype: 'treecolumn',
            text: gettext('ID/Node'),
            dataIndex: 'text',
            width: 200,
        },
        {
            header: gettext('Comment'),
            dataIndex: 'description',
            renderer: function (value, _meta, record) {
                return Ext.String.htmlEncode(value ?? record.data.comment);
            },
            flex: 1,
        },
    ],
});
