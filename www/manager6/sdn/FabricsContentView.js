Ext.define('PVE.sdn.FabricRoutesContentView', {
    extend: 'Ext.grid.GridPanel',
    alias: 'widget.pveSDNFabricRoutesContentView',

    columns: [
        {
            header: gettext('Route'),
            sortable: true,
            dataIndex: 'route',
            flex: 1,
        },
        {
            header: gettext('Via'),
            sortable: true,
            dataIndex: 'via',
            renderer: (value) => {
                if (Ext.isArray(value)) {
                    return value.join('<br>');
                }
                return value || '';
            },
            flex: 1,
        },
    ],
});

Ext.define('PVE.sdn.FabricNeighborsContentView', {
    extend: 'Ext.grid.GridPanel',
    alias: 'widget.pveSDNFabricNeighborsContentView',

    columns: [
        {
            header: gettext('Neighbor'),
            sortable: true,
            dataIndex: 'neighbor',
            flex: 1,
        },
        {
            header: gettext('Status'),
            sortable: true,
            dataIndex: 'status',
            flex: 0.5,
        },
        {
            header: gettext('Uptime'),
            sortable: true,
            dataIndex: 'uptime',
            flex: 0.5,
        },
    ],
});

Ext.define('PVE.sdn.FabricInterfacesContentView', {
    extend: 'Ext.grid.GridPanel',
    alias: 'widget.pveSDNFabricInterfacesContentView',

    columns: [
        {
            header: gettext('Name'),
            sortable: true,
            dataIndex: 'name',
            flex: 1,
        },
        {
            header: gettext('Type'),
            sortable: true,
            dataIndex: 'type',
            flex: 1,
        },
        {
            header: gettext('State'),
            sortable: true,
            dataIndex: 'state',
            flex: 1,
        },
    ],
});
