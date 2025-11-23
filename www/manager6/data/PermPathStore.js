Ext.define('PVE.data.PermPathStore', {
    extend: 'Ext.data.Store',
    alias: 'store.pvePermPath',
    fields: ['value'],
    autoLoad: false,
    data: [
        { value: '/' },
        { value: '/access' },
        { value: '/access/groups' },
        { value: '/access/realm' },
        { value: '/mapping' },
        { value: '/mapping/hwrng' },
        { value: '/mapping/notifications' },
        { value: '/mapping/pci' },
        { value: '/mapping/usb' },
        { value: '/nodes' },
        { value: '/pool' },
        { value: '/sdn/fabrics' },
        { value: '/sdn/zones' },
        { value: '/storage' },
        { value: '/vms' },
    ],

    constructor: function (config) {
        var me = this;

        config = config || {};

        me.callParent([config]);

        let donePaths = {};
        me.suspendEvents();
        PVE.data.ResourceStore.each(function (record) {
            let path;
            switch (record.get('type')) {
                case 'node':
                    path = '/nodes/' + record.get('text');
                    break;
                case 'qemu':
                    path = '/vms/' + record.get('vmid');
                    break;
                case 'lxc':
                    path = '/vms/' + record.get('vmid');
                    break;
                case 'sdn':
                    path = '/sdn/zones/' + record.get('sdn');
                    break;
                case 'storage':
                    path = '/storage/' + record.get('storage');
                    break;
                case 'pool':
                    path = '/pool/' + record.get('pool');
                    break;
            }
            if (path !== undefined && !donePaths[path]) {
                me.add({ value: path });
                donePaths[path] = 1;
            }
        });
        me.resumeEvents();

        me.fireEvent('refresh', me);
        me.fireEvent('datachanged', me);

        me.sort({
            property: 'value',
            direction: 'ASC',
        });
    },
});
