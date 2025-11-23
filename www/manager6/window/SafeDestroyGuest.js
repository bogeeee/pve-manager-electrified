/*
 * SafeDestroy window with additional checkboxes for removing guests
 */
Ext.define('PVE.window.SafeDestroyGuest', {
    extend: 'Proxmox.window.SafeDestroy',
    alias: 'widget.pveSafeDestroyGuest',

    additionalItems: [
        {
            xtype: 'proxmoxcheckbox',
            name: 'purge',
            reference: 'purgeCheckbox',
            boxLabel: gettext('Purge from job configurations'),
            checked: false,
            autoEl: {
                tag: 'div',
                'data-qtip': gettext('Remove from replication, HA and backup jobs'),
            },
        },
        {
            xtype: 'proxmoxcheckbox',
            name: 'destroyUnreferenced',
            reference: 'destroyUnreferencedCheckbox',
            boxLabel: gettext('Destroy unreferenced disks owned by guest'),
            checked: false,
            autoEl: {
                tag: 'div',
                'data-qtip': gettext(
                    'Scan all enabled storages for unreferenced disks and delete them.',
                ),
            },
        },
    ],

    note: gettext('Referenced disks will always be destroyed.'),

    getParams: function () {
        let me = this;

        const purgeCheckbox = me.lookupReference('purgeCheckbox');
        me.params.purge = purgeCheckbox.checked ? 1 : 0;

        const destroyUnreferencedCheckbox = me.lookupReference('destroyUnreferencedCheckbox');
        me.params['destroy-unreferenced-disks'] = destroyUnreferencedCheckbox.checked ? 1 : 0;

        return me.callParent();
    },
});
